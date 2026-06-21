/**
 * FSRS-powered exam scheduling engine.
 *
 * Core insight: the FSRS retrievability formula R = (1 + t/(9·S))^-1 lets us
 * predict recall on *any* future date given a card's current stability S and
 * the time t (days) since its last review. We use this to:
 *
 *   1. Predict exam-day retention for every card.
 *   2. Identify cards scheduled past the exam ("pull-forward" candidates).
 *   3. Build a per-day load forecast so reviews spread evenly.
 *   4. Assign urgency scores so cards with low predicted retention surface first.
 */

import type { Card, Deck, Exam, Folder } from './types'
import type { FSRSState } from './srs'

// ── Core FSRS math ────────────────────────────────────────────────────────────

/** Predicted retrievability on `targetDate` given current FSRS state. */
export function fsrsRetentionAtDate(state: FSRSState, targetDate: Date): number {
  if (!state.lastReviewedAt || state.stability <= 0) return 0
  const t =
    (targetDate.getTime() - new Date(state.lastReviewedAt).getTime()) /
    (1000 * 60 * 60 * 24)
  if (t <= 0) return 1 // reviewing in the past → full retention
  return Math.pow(1 + t / (9 * state.stability), -1)
}

// ── Folder/deck resolution ────────────────────────────────────────────────────

function descendantFolderIds(folders: Folder[], rootId: string): string[] {
  const direct = folders.filter((f) => f.parentId === rootId).map((f) => f.id)
  return direct.flatMap((id) => [id, ...descendantFolderIds(folders, id)])
}

/** All deck IDs that belong to an exam (direct decks + recursive folder tree). */
export function getExamDeckIds(exam: Exam, decks: Deck[], folders: Folder[]): string[] {
  const ids = new Set(exam.deckIds)
  for (const folderId of exam.folderIds ?? []) {
    const allFolderIds = [folderId, ...descendantFolderIds(folders, folderId)]
    for (const deck of decks) {
      if (deck.folderId && allFolderIds.includes(deck.folderId)) ids.add(deck.id)
    }
  }
  return [...ids]
}

/** All cards that belong to an exam. */
export function getExamCards(
  exam: Exam,
  decks: Deck[],
  cards: Card[],
  folders: Folder[],
): Card[] {
  const deckIds = new Set(getExamDeckIds(exam, decks, folders))
  return cards.filter((c) => deckIds.has(c.deckId))
}

// ── Retention stats ───────────────────────────────────────────────────────────

export interface ExamRetentionStats {
  totalCards: number
  newCards: number           // never reviewed
  reviewedCards: number
  onTarget: number           // predicted retention ≥ targetRetention on exam day
  atRisk: number             // predicted retention < targetRetention
  avgRetention: number       // avg predicted retention across all exam cards; new cards count as 0 (0–1)
  pulledForwardCount: number // cards whose natural due date is past the exam
  /** Per-day review load needed if we spread pulled-forward cards evenly. */
  dailyLoadNeeded: number
}

export function computeExamRetentionStats(
  exam: Exam,
  cards: Card[],
  fsrsData: Record<string, FSRSState>,
): ExamRetentionStats {
  const examDate = new Date(exam.date + 'T23:59:59')
  const now = new Date()
  const daysUntilExam = Math.max(1, (examDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  const target = exam.targetRetention ?? 0.90

  let newCards = 0
  let reviewed = 0
  let onTarget = 0
  let atRisk = 0
  let retentionSum = 0
  let pulledForward = 0

  for (const card of cards) {
    const state = fsrsData[card.id]
    if (!state || state.state === 'new') {
      newCards++
      continue
    }
    reviewed++
    const r = fsrsRetentionAtDate(state, examDate)
    retentionSum += r

    if (r >= target) {
      onTarget++
    } else {
      atRisk++
    }

    if (new Date(state.dueDate) > examDate) {
      pulledForward++
    }
  }

  return {
    totalCards: cards.length,
    newCards,
    reviewedCards: reviewed,
    onTarget,
    atRisk,
    // New/unreviewed cards count as 0 retention so readiness reflects overall
    // mastery, not just the subset of cards that have been studied at least once.
    avgRetention: cards.length > 0 ? retentionSum / cards.length : 0,
    pulledForwardCount: pulledForward,
    dailyLoadNeeded: pulledForward > 0 ? Math.ceil(pulledForward / daysUntilExam) : 0,
  }
}

// ── Pull-forward logic ────────────────────────────────────────────────────────

/**
 * Returns IDs of cards that should be pulled into today's review because:
 *   - their natural FSRS due date is after the exam, AND
 *   - their predicted retention on exam day is below the target.
 */
export function getPulledForwardCardIds(
  exam: Exam,
  cards: Card[],
  fsrsData: Record<string, FSRSState>,
): string[] {
  const examDate = new Date(exam.date + 'T23:59:59')
  const now = new Date()
  if (examDate <= now) return []

  const target = exam.targetRetention ?? 0.90

  return cards
    .filter((c) => {
      const state = fsrsData[c.id]
      if (!state || state.state === 'new') return false
      const dueDate = new Date(state.dueDate)
      if (dueDate <= now) return false       // already due — regular queue handles it
      if (dueDate <= examDate) return false  // scheduled before exam — fine
      // Card is scheduled after exam — will it still hit the target?
      return fsrsRetentionAtDate(state, examDate) < target
    })
    .map((c) => c.id)
}

// ── Urgency scoring ───────────────────────────────────────────────────────────

/**
 * For every card, compute an urgency score based on how far below the target
 * retention it will be on exam day AND how soon the exam is.
 * Higher score → show this card first in the inbox.
 */
export function computeCardUrgencies(
  cards: Card[],
  fsrsData: Record<string, FSRSState>,
  exams: Exam[],
  decks: Deck[],
  folders: Folder[],
): Map<string, number> {
  const urgencies = new Map<string, number>()
  const now = new Date()

  for (const exam of exams) {
    const examDate = new Date(exam.date + 'T23:59:59')
    if (examDate <= now) continue
    const daysUntilExam = (examDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    const examDeckIds = new Set(getExamDeckIds(exam, decks, folders))
    const target = exam.targetRetention ?? 0.90

    for (const card of cards) {
      if (!examDeckIds.has(card.deckId)) continue
      const state = fsrsData[card.id]
      if (!state || state.state === 'new') continue

      const retention = fsrsRetentionAtDate(state, examDate)
      const gap = Math.max(0, target - retention)
      // urgency grows as gap widens and exam approaches
      const score = gap * (100 / Math.max(1, daysUntilExam))
      const prev = urgencies.get(card.id) ?? 0
      if (score > prev) urgencies.set(card.id, score)
    }
  }

  return urgencies
}

// ── Load forecast ─────────────────────────────────────────────────────────────

/** How many reviews per day are needed to clear the pulled-forward backlog by exam day? */
export function dailyReviewsNeeded(
  exam: Exam,
  cards: Card[],
  fsrsData: Record<string, FSRSState>,
): number {
  const examDate = new Date(exam.date + 'T23:59:59')
  const now = new Date()
  const daysLeft = Math.max(1, (examDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  const count = getPulledForwardCardIds(exam, cards, fsrsData).length
  return count > 0 ? Math.ceil(count / daysLeft) : 0
}

// ── Per-topic breakdown ───────────────────────────────────────────────────────

export interface TopicBreakdown {
  id: string
  name: string
  type: 'deck' | 'folder'
  readiness: number  // 0–100 integer
  cardCount: number
}

/**
 * Returns a per-folder / per-deck readiness breakdown for the topics explicitly
 * added to an exam. Folders are shown as a single aggregate (including subfolders).
 * Items are sorted lowest-readiness first so the weakest topic is always at the top.
 */
export function computePerTopicBreakdown(
  exam: Exam,
  decks: Deck[],
  cards: Card[],
  folders: Folder[],
  fsrsData: Record<string, FSRSState>,
): TopicBreakdown[] {
  const examDate = new Date(exam.date + 'T23:59:59')
  const result: TopicBreakdown[] = []

  // Each linked folder → aggregate all cards in it (including subfolder decks)
  for (const folderId of exam.folderIds ?? []) {
    const folder = folders.find((f) => f.id === folderId)
    if (!folder) continue
    const allFolderIds = [folderId, ...descendantFolderIds(folders, folderId)]
    const deckIds = new Set(
      decks.filter((d) => d.folderId && allFolderIds.includes(d.folderId)).map((d) => d.id),
    )
    const folderCards = cards.filter((c) => deckIds.has(c.deckId))
    const reviewed = folderCards.filter((c) => fsrsData[c.id]?.state !== 'new')
    const avg =
      folderCards.length > 0
        ? reviewed.reduce((s, c) => s + fsrsRetentionAtDate(fsrsData[c.id], examDate), 0) /
          folderCards.length
        : 0
    result.push({
      id: folderId,
      name: folder.name,
      type: 'folder',
      readiness: Math.round(avg * 100),
      cardCount: folderCards.length,
    })
  }

  // Each individually-linked deck
  for (const deckId of exam.deckIds) {
    const deck = decks.find((d) => d.id === deckId)
    if (!deck) continue
    const deckCards = cards.filter((c) => c.deckId === deckId)
    const reviewed = deckCards.filter((c) => fsrsData[c.id]?.state !== 'new')
    const avg =
      deckCards.length > 0
        ? reviewed.reduce((s, c) => s + fsrsRetentionAtDate(fsrsData[c.id], examDate), 0) /
          deckCards.length
        : 0
    result.push({
      id: deckId,
      name: deck.name,
      type: 'deck',
      readiness: Math.round(avg * 100),
      cardCount: deckCards.length,
    })
  }

  return result.sort((a, b) => a.readiness - b.readiness)
}

// ── Weakest-card selection ────────────────────────────────────────────────────

/**
 * Returns up to `limit` cards from the exam, sorted ascending by predicted
 * FSRS retrievability on exam day. New/unreviewed cards (retrievability = 0)
 * surface first, making this ideal for a "study your weak spots" session.
 */
export function getWeakestCards(
  exam: Exam,
  decks: Deck[],
  cards: Card[],
  folders: Folder[],
  fsrsData: Record<string, FSRSState>,
  limit = 50,
): Card[] {
  const examDate = new Date(exam.date + 'T23:59:59')
  const examCards = getExamCards(exam, decks, cards, folders)

  return examCards
    .map((c) => {
      const state = fsrsData[c.id]
      const retention =
        state && state.state !== 'new' ? fsrsRetentionAtDate(state, examDate) : 0
      return { card: c, retention }
    })
    .sort((a, b) => a.retention - b.retention)
    .slice(0, limit)
    .map(({ card }) => card)
}
