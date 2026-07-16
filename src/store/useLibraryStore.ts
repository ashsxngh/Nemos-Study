'use client'

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { Folder, Deck, Card, ReviewLog, FolderColor, CardType } from '@/lib/types'
import {
  fsrsInitCard,
  fsrsSchedule,
  fsrsRetrievability,
  DEFAULT_FSRS_PARAMS,
} from '@/lib/srs'
import type { FSRSState } from '@/lib/srs'
import { useSettingsStore } from '@/store/useSettingsStore'
import { useTrashStore } from '@/store/useTrashStore'
import { useExamStore } from '@/store/useExamStore'
import { useHistoryStore } from '@/store/useHistoryStore'
import { getExamDeckIds, getPulledForwardCardIds, computeCardUrgencies } from '@/lib/examScheduler'
import { generateId } from '@/lib/utils'
import { createIDBStorage } from '@/lib/idbStorage'
import { CARD_TEXT_MAX_LENGTH, NAME_MAX_LENGTH } from '@/lib/limits'
import { toLocalDateStr } from '@/lib/formatDate'

const USER_ID = 'local-user'

interface PendingDeletes {
  folders: string[]
  decks: string[]
  cards: string[]
  sessions: string[]
  reviewLogs: string[]
}

interface LibraryState {
  folders: Folder[]
  decks: Deck[]
  cards: Card[]
  fsrsData: Record<string, FSRSState>
  pendingDeletes: PendingDeletes

  // Folder actions
  createFolder: (name: string, parentId?: string | null, color?: FolderColor) => Folder
  updateFolder: (id: string, updates: Partial<Pick<Folder, 'name' | 'color' | 'isStarred' | 'isArchived' | 'order' | 'parentId'>>) => void
  deleteFolder: (id: string) => void

  // Deck actions
  createDeck: (name: string, folderId?: string | null, description?: string) => Deck
  updateDeck: (id: string, updates: Partial<Pick<Deck, 'name' | 'description' | 'folderId' | 'isStarred' | 'isArchived' | 'tags' | 'order'>>) => void
  deleteDeck: (id: string) => void

  // Card actions
  createCard: (deckId: string, front: string, back: string, type?: CardType, tags?: string[]) => Card
  importCards: (deckId: string, cards: Array<{ front: string; back: string; type?: CardType; tags?: string[] }>) => void
  updateCard: (id: string, updates: Partial<Pick<Card, 'front' | 'back' | 'type' | 'hint' | 'tags' | 'isPinned' | 'isArchived' | 'order' | 'deckId'>>) => void
  // Applies many card updates in a single setState/persist write — used for
  // bulk operations (drag-reorder, bulk move/tag/delete) where updating one
  // card at a time would clone the full cards array N times.
  updateCardsBatch: (updates: Array<{ id: string; updates: Partial<Pick<Card, 'front' | 'back' | 'type' | 'hint' | 'tags' | 'isPinned' | 'isArchived' | 'order' | 'deckId'>> }>) => void
  deleteCard: (id: string) => void
  // Same as calling deleteCard per id, but a single setState/persist write —
  // used by bulk-delete in the deck view instead of N individual deletes.
  deleteCardsBatch: (ids: string[]) => void

  // SRS actions
  initCardSRS: (cardId: string) => void
  reviewCard: (cardId: string, rating: 1 | 2 | 3 | 4, responseMs?: number, sessionId?: string) => void
  setFSRSData: (cardId: string, fsrs: FSRSState) => void
  resetCardSRS: (cardId: string) => void
  clearPendingDeletes: (processed: { folders: string[], decks: string[], cards: string[], sessions: string[], reviewLogs: string[] }) => void

  // Query helpers
  getNewCards: (deckId?: string) => Card[]
  getReviewsDue: (deckId?: string) => Card[]
  getDueCards: (deckId?: string) => Card[]
  // Deck-scoped "Study" popup modes — operate only on one deck, bypass the
  // inbox's due-date gating entirely.
  getDeckReviewsAll: (deckId: string) => Card[]
  getDeckNewAll: (deckId: string) => Card[]
  getDeckBoth: (deckId: string) => Card[]
  getDeckCards: (deckId: string) => Card[]
  getFolderChildren: (folderId: string | null) => Folder[]
  getDeckMastery: (deckId: string) => number
}

function clamp(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) : str
}

function getAllDescendantFolderIds(folders: Folder[], rootId: string): string[] {
  const direct = folders.filter((f) => f.parentId === rootId).map((f) => f.id)
  return direct.flatMap((id) => [id, ...getAllDescendantFolderIds(folders, id)])
}

// ── Queue ordering helpers ──────────────────────────────────────────────────
// Primary sort: due date ascending (most overdue first). Secondary: a
// weighted round-robin across decks so one huge overdue deck doesn't
// monopolize the front of the queue — decks with more overdue severity get
// pulled from more often, but every deck with due cards gets interleaved in.

function daysOverdue(dueDateIso: string): number {
  return Math.max(0, (Date.now() - new Date(dueDateIso).getTime()) / 86400000)
}

function interleaveByDeck<T>(
  items: T[],
  getDeckId: (item: T) => string,
  getWeight: (item: T) => number,
): T[] {
  if (items.length <= 1) return items
  const buckets = new Map<string, { queue: T[]; weight: number; credit: number }>()
  for (const item of items) {
    const deckId = getDeckId(item)
    let bucket = buckets.get(deckId)
    if (!bucket) {
      bucket = { queue: [], weight: 0, credit: 0 }
      buckets.set(deckId, bucket)
    }
    bucket.queue.push(item)
    bucket.weight += 1 + getWeight(item)
  }
  const totalWeight = Array.from(buckets.values()).reduce((sum, b) => sum + b.weight, 0)
  const result: T[] = []
  let remaining = items.length
  while (remaining > 0) {
    let pick: { queue: T[]; weight: number; credit: number } | null = null
    for (const bucket of buckets.values()) {
      if (bucket.queue.length === 0) continue
      bucket.credit += bucket.weight
      if (!pick || bucket.credit > pick.credit) pick = bucket
    }
    if (!pick) break
    result.push(pick.queue.shift()!)
    pick.credit -= totalWeight
    remaining--
  }
  return result
}

// Pulls the 2-3 highest-retrievability cards (already-graduated cards the
// learner is most confident on) to the front as a warmup before the harder,
// more-overdue cards that follow.
function withWarmup<T>(queue: T[], getRetrievability: (item: T) => number | null): T[] {
  if (queue.length <= 3) return queue
  const scored = queue
    .map((item, index) => ({ item, index, r: getRetrievability(item) }))
    .filter((s) => s.r !== null) as { item: T; index: number; r: number }[]
  if (scored.length === 0) return queue
  const warmupCount = Math.min(3, Math.max(2, Math.floor(queue.length * 0.1)), scored.length)
  const warmup = [...scored].sort((a, b) => b.r - a.r).slice(0, warmupCount)
  const warmupIndices = new Set(warmup.map((w) => w.index))
  const rest = queue.filter((_, i) => !warmupIndices.has(i))
  return [...warmup.map((w) => w.item), ...rest]
}

export const useLibraryStore = create<LibraryState>()(
  persist(
    (set, get) => ({
      folders: [],
      decks: [],
      cards: [],
      fsrsData: {},
      pendingDeletes: { folders: [], decks: [], cards: [], sessions: [], reviewLogs: [] },

      // ── Folder actions ──────────────────────────────────────────────────────
      createFolder: (name, parentId = null, color = 'default') => {
        const now = new Date().toISOString()
        const folder: Folder = {
          id: generateId(),
          userId: USER_ID,
          parentId: parentId ?? null,
          name: clamp(name, NAME_MAX_LENGTH),
          color,
          isStarred: false,
          isArchived: false,
          order: get().folders.length,
          createdAt: now,
          updatedAt: now,
        }
        set((s) => ({ folders: [...s.folders, folder] }))
        return folder
      },

      updateFolder: (id, updates) => {
        const clamped = updates.name !== undefined ? { ...updates, name: clamp(updates.name, NAME_MAX_LENGTH) } : updates
        set((s) => ({
          folders: s.folders.map((f) =>
            f.id === id ? { ...f, ...clamped, updatedAt: new Date().toISOString() } : f
          ),
        }))
      },

      deleteFolder: (id) => {
        const { folders, decks, cards, fsrsData, pendingDeletes } = get()
        const descendantIds = getAllDescendantFolderIds(folders, id)
        const allFolderIds = [id, ...descendantIds]
        const deckIdsToDelete = decks.filter((d) => d.folderId && allFolderIds.includes(d.folderId)).map((d) => d.id)
        const cardIdsToDelete = cards.filter((c) => deckIdsToDelete.includes(c.deckId)).map((c) => c.id)
        const cardIdSet = new Set(cardIdsToDelete)
        const deckIdSet = new Set(deckIdsToDelete)
        const newFsrsData = { ...fsrsData }
        cardIdsToDelete.forEach((cid) => {
          delete newFsrsData[cid]
        })
        const { sessionIds, logIds } = useHistoryStore.getState().pruneHistory(cardIdSet, deckIdSet)
        set({
          folders: folders.filter((f) => !allFolderIds.includes(f.id)),
          decks: decks.filter((d) => !deckIdsToDelete.includes(d.id)),
          cards: cards.filter((c) => !cardIdsToDelete.includes(c.id)),
          fsrsData: newFsrsData,
          pendingDeletes: {
            folders: [...(pendingDeletes.folders ?? []), ...allFolderIds],
            decks: [...(pendingDeletes.decks ?? []), ...deckIdsToDelete],
            cards: [...(pendingDeletes.cards ?? []), ...cardIdsToDelete],
            sessions: [...(pendingDeletes.sessions ?? []), ...sessionIds],
            reviewLogs: [...(pendingDeletes.reviewLogs ?? []), ...logIds],
          },
        })
      },

      // ── Deck actions ────────────────────────────────────────────────────────
      createDeck: (name, folderId = null, description = '') => {
        const now = new Date().toISOString()
        const deck: Deck = {
          id: generateId(),
          userId: USER_ID,
          folderId: folderId ?? null,
          name: clamp(name, NAME_MAX_LENGTH),
          description,
          isStarred: false,
          isArchived: false,
          tags: [],
          order: get().decks.length,
          createdAt: now,
          updatedAt: now,
        }
        set((s) => ({ decks: [...s.decks, deck] }))
        return deck
      },

      updateDeck: (id, updates) => {
        const clamped = updates.name !== undefined ? { ...updates, name: clamp(updates.name, NAME_MAX_LENGTH) } : updates
        set((s) => ({
          decks: s.decks.map((d) =>
            d.id === id ? { ...d, ...clamped, updatedAt: new Date().toISOString() } : d
          ),
        }))
      },

      deleteDeck: (id) => {
        const { cards, decks, folders, fsrsData } = get()
        const deck = decks.find((d) => d.id === id)
        const deckCards = cards.filter((c) => c.deckId === id)
        const cardIdsToDelete = deckCards.map((c) => c.id)
        const cardIdSet = new Set(cardIdsToDelete)
        const newFsrsData = { ...fsrsData }
        cardIdsToDelete.forEach((cid) => {
          delete newFsrsData[cid]
        })

        // Save to trash before removing
        if (deck) {
          const folderName = deck.folderId
            ? folders.find((f) => f.id === deck.folderId)?.name
            : undefined
          const deckFSRS: Record<string, typeof fsrsData[string]> = {}
          cardIdsToDelete.forEach((cid) => {
            if (fsrsData[cid]) deckFSRS[cid] = fsrsData[cid]
          })
          useTrashStore.getState().add({
            id: deck.id,
            type: 'deck',
            deletedAt: new Date().toISOString(),
            name: deck.name,
            parentName: folderName,
            cardCount: deckCards.length,
            deck,
            deckCards,
            deckFSRS,
          })
        }

        const { sessionIds, logIds } = useHistoryStore.getState().pruneHistory(cardIdSet, new Set([id]))
        set((s) => ({
          decks: s.decks.filter((d) => d.id !== id),
          cards: s.cards.filter((c) => c.deckId !== id),
          fsrsData: newFsrsData,
          pendingDeletes: {
            folders: s.pendingDeletes.folders ?? [],
            decks: [...(s.pendingDeletes.decks ?? []), id],
            cards: [...(s.pendingDeletes.cards ?? []), ...cardIdsToDelete],
            sessions: [...(s.pendingDeletes.sessions ?? []), ...sessionIds],
            reviewLogs: [...(s.pendingDeletes.reviewLogs ?? []), ...logIds],
          },
        }))
      },

      // ── Card actions ────────────────────────────────────────────────────────
      createCard: (deckId, front, back, type = 'basic', tags = []) => {
        const now = new Date().toISOString()
        const card: Card = {
          id: generateId(),
          deckId,
          userId: USER_ID,
          type,
          front: clamp(front, CARD_TEXT_MAX_LENGTH),
          back: clamp(back, CARD_TEXT_MAX_LENGTH),
          hint: '',
          tags: tags ?? [],
          isPinned: false,
          isArchived: false,
          linkedCardIds: [],
          prerequisiteCardIds: [],
          order: get().cards.filter((c) => c.deckId === deckId).length,
          createdAt: now,
          updatedAt: now,
        }
        const fsrs = fsrsInitCard(card.id, USER_ID)
        set((s) => ({
          cards: [...s.cards, card],
          fsrsData: { ...s.fsrsData, [card.id]: fsrs },
        }))
        return card
      },

      // Bulk import — builds all cards + SRS entries in-memory then does a single
      // set() call. Avoids the O(n²) cost of calling createCard() n times (each
      // call spreads the full cards array and triggers a storage serialization).
      importCards: (deckId, rawCards) => {
        if (!rawCards.length) return
        const now = new Date().toISOString()
        const baseOrder = get().cards.filter((c) => c.deckId === deckId).length
        const newCards: Card[] = []
        const newFsrsData: Record<string, FSRSState> = {}
        rawCards.forEach((raw, i) => {
          const card: Card = {
            id: generateId(),
            deckId,
            userId: USER_ID,
            type: raw.type ?? 'basic',
            front: clamp(raw.front, CARD_TEXT_MAX_LENGTH),
            back: clamp(raw.back, CARD_TEXT_MAX_LENGTH),
            hint: '',
            tags: raw.tags ?? [],
            isPinned: false,
            isArchived: false,
            linkedCardIds: [],
            prerequisiteCardIds: [],
            order: baseOrder + i,
            createdAt: now,
            updatedAt: now,
          }
          newFsrsData[card.id] = fsrsInitCard(card.id, USER_ID)
          newCards.push(card)
        })
        set((s) => ({
          cards: [...s.cards, ...newCards],
          fsrsData: { ...s.fsrsData, ...newFsrsData },
        }))
      },

      updateCard: (id, updates) => {
        const clamped = { ...updates }
        if (clamped.front !== undefined) clamped.front = clamp(clamped.front, CARD_TEXT_MAX_LENGTH)
        if (clamped.back !== undefined) clamped.back = clamp(clamped.back, CARD_TEXT_MAX_LENGTH)
        set((s) => ({
          cards: s.cards.map((c) =>
            c.id === id ? { ...c, ...clamped, updatedAt: new Date().toISOString() } : c
          ),
        }))
      },

      updateCardsBatch: (updates) => {
        set((s) => {
          const now = new Date().toISOString()
          const updateMap = new Map(updates.map((u) => [u.id, u.updates]))
          return {
            cards: s.cards.map((c) => {
              const u = updateMap.get(c.id)
              if (!u) return c
              const clamped = { ...u }
              if (clamped.front !== undefined) clamped.front = clamp(clamped.front, CARD_TEXT_MAX_LENGTH)
              if (clamped.back !== undefined) clamped.back = clamp(clamped.back, CARD_TEXT_MAX_LENGTH)
              return { ...c, ...clamped, updatedAt: now }
            }),
          }
        })
      },

      deleteCard: (id) => {
        const { cards, decks, fsrsData } = get()
        const card = cards.find((c) => c.id === id)
        const newFsrsData = { ...fsrsData }
        delete newFsrsData[id]

        // Save to trash before removing
        if (card) {
          const deckName = decks.find((d) => d.id === card.deckId)?.name
          useTrashStore.getState().add({
            id: card.id,
            type: 'card',
            deletedAt: new Date().toISOString(),
            name: card.front,
            parentName: deckName,
            snippet: card.back?.slice(0, 120),
            card,
            cardFSRS: fsrsData[id],
          })
        }

        // Prune this card's review logs (locally + queued for server delete),
        // same as deleteFolder/deleteDeck. Card-scoped only — the empty deck
        // set leaves sessions alone, since a session can span cards that
        // still exist.
        const { logIds } = useHistoryStore.getState().pruneHistory(new Set([id]), new Set())

        set((s) => ({
          cards: s.cards.filter((c) => c.id !== id),
          fsrsData: newFsrsData,
          pendingDeletes: {
            ...s.pendingDeletes,
            cards: [...(s.pendingDeletes.cards ?? []), id],
            reviewLogs: [...(s.pendingDeletes.reviewLogs ?? []), ...logIds],
          },
        }))
      },

      deleteCardsBatch: (ids) => {
        if (!ids.length) return
        const { cards, decks, fsrsData } = get()
        const idSet = new Set(ids)
        const newFsrsData = { ...fsrsData }
        ids.forEach((id) => {
          delete newFsrsData[id]
        })

        // Save each to trash before removing (trash's own list is small —
        // this loop isn't the O(n²) hazard the cards/fsrsData clones are).
        ids.forEach((id) => {
          const card = cards.find((c) => c.id === id)
          if (!card) return
          const deckName = decks.find((d) => d.id === card.deckId)?.name
          useTrashStore.getState().add({
            id: card.id,
            type: 'card',
            deletedAt: new Date().toISOString(),
            name: card.front,
            parentName: deckName,
            snippet: card.back?.slice(0, 120),
            card,
            cardFSRS: fsrsData[id],
          })
        })

        // Prune the deleted cards' review logs — see deleteCard.
        const { logIds } = useHistoryStore.getState().pruneHistory(idSet, new Set())

        set((s) => ({
          cards: s.cards.filter((c) => !idSet.has(c.id)),
          fsrsData: newFsrsData,
          pendingDeletes: {
            ...s.pendingDeletes,
            cards: [...(s.pendingDeletes.cards ?? []), ...ids],
            reviewLogs: [...(s.pendingDeletes.reviewLogs ?? []), ...logIds],
          },
        }))
      },

      // ── SRS actions ─────────────────────────────────────────────────────────
      initCardSRS: (cardId) => {
        const { fsrsData } = get()
        if (!fsrsData[cardId]) {
          set((s) => ({ fsrsData: { ...s.fsrsData, [cardId]: fsrsInitCard(cardId, USER_ID) } }))
        }
      },

      setFSRSData: (cardId, fsrs) => {
        // Fresh updatedAt stamp: whatever is being written (e.g. an undo
        // restoring a pre-review snapshot) is the user's latest local intent,
        // so it must win the sync pull's recency merge and get re-pushed.
        set((s) => ({ fsrsData: { ...s.fsrsData, [cardId]: { ...fsrs, updatedAt: new Date().toISOString() } } }))
      },

      resetCardSRS: (cardId) => {
        set((s) => ({
          fsrsData: { ...s.fsrsData, [cardId]: fsrsInitCard(cardId, USER_ID) },
        }))
      },

      reviewCard: (cardId, rating, responseMs = 0, sessionId) => {
        const {
          fsrsWeights,
          fsrsTargetRetention,
          fsrsMaxInterval,
          leechThreshold,
          autoSuspendLeeches,
        } = useSettingsStore.getState()

        // Auto-suspend leeches: archive + tag the card once lapses hit the threshold
        const suspendIfLeech = (cards: Card[], lapses: number): Card[] => {
          if (!autoSuspendLeeches || rating !== 1 || lapses < leechThreshold) return cards
          return cards.map((c) =>
            c.id === cardId
              ? {
                  ...c,
                  isArchived: true,
                  tags: c.tags.includes('leech') ? c.tags : [...c.tags, 'leech'],
                  updatedAt: new Date().toISOString(),
                }
              : c
          )
        }

        const existing = get().fsrsData[cardId] ?? fsrsInitCard(cardId, USER_ID)
        const wasNew = existing.state === 'new'
        const fsrsParams = {
          ...DEFAULT_FSRS_PARAMS,
          weights: fsrsWeights,
          targetRetention: fsrsTargetRetention,
          maximumInterval: fsrsMaxInterval,
          requestRetention: fsrsTargetRetention,
        }
        const updated = fsrsSchedule(existing, rating, fsrsParams)
        // Cards graduating from new should be reviewable the same day
        if (wasNew && rating >= 3) {
          updated.dueDate = new Date().toISOString()
        }
        // Client recency stamp for the sync pull merge — fsrsSchedule spreads
        // the previous state, so without this a row pulled from the server
        // would carry its stale server updated_at forward and the pull merge
        // couldn't tell this review is newer than the server's copy.
        updated.updatedAt = new Date().toISOString()

        // Derive a whole-day interval for the review log
        const daysDiff =
          (new Date(updated.dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        const logInterval = Math.max(1, Math.round(daysDiff))

        // The caller's ReviewSession id, so logs are joinable to the session
        // they were reviewed in (Session Fatigue groups logs by sessionId).
        // Fallback for a review outside any session: a one-off id, so an
        // unattributed log forms a harmless singleton group instead of all
        // unattributed logs merging into one fake mega-session.
        const log: ReviewLog = {
          id: generateId(),
          sessionId: sessionId ?? generateId(),
          cardId,
          userId: USER_ID,
          rating,
          responseMs,
          reviewedAt: new Date().toISOString(),
          scheduledInterval: logInterval,
          ease: updated.difficulty,
          wasNew,
        }
        set((s) => ({
          fsrsData: { ...s.fsrsData, [cardId]: updated },
          cards: suspendIfLeech(s.cards, updated.lapses),
        }))
        useHistoryStore.getState().addReviewLog(log)
      },

      clearPendingDeletes: (processed) => {
        const folderSet  = new Set(processed.folders)
        const deckSet    = new Set(processed.decks)
        const cardSet    = new Set(processed.cards)
        const sessionSet = new Set(processed.sessions)
        const logSet     = new Set(processed.reviewLogs)
        set((s) => ({
          pendingDeletes: {
            folders:    (s.pendingDeletes.folders ?? []).filter((id) => !folderSet.has(id)),
            decks:      (s.pendingDeletes.decks ?? []).filter((id) => !deckSet.has(id)),
            cards:      (s.pendingDeletes.cards ?? []).filter((id) => !cardSet.has(id)),
            sessions:   (s.pendingDeletes.sessions ?? []).filter((id) => !sessionSet.has(id)),
            reviewLogs: (s.pendingDeletes.reviewLogs ?? []).filter((id) => !logSet.has(id)),
          },
        }))
      },

      // ── Query helpers ────────────────────────────────────────────────────────
      getNewCards: (deckId) => {
        const { cards, fsrsData, decks } = get()
        const { reviewLogs } = useHistoryStore.getState()
        const { newCardsPerDay } = useSettingsStore.getState()
        const todayStr = toLocalDateStr(new Date())
        const deckSet = new Set(decks.map((d) => d.id))
        const pool = (deckId ? cards.filter((c) => c.deckId === deckId) : cards)
          .filter((c) => !c.isArchived && deckSet.has(c.deckId))

        // Count new cards introduced today using wasNew-flagged logs (Issue 7).
        // This correctly excludes lapsed graduated cards.
        // Precompute the set of cards touched by a wasNew log today in one pass
        // over reviewLogs (O(logs)) instead of scanning all logs per card (O(cards×logs)).
        const wasNewTodayCardIds = new Set<string>()
        for (const l of reviewLogs) {
          if (l.wasNew === true && toLocalDateStr(new Date(l.reviewedAt)) === todayStr) wasNewTodayCardIds.add(l.cardId)
        }
        const studiedNewToday = pool.filter((c) => wasNewTodayCardIds.has(c.id)).length

        const remaining = Math.max(0, newCardsPerDay - studiedNewToday)
        if (remaining === 0) return []

        const eligible = pool.filter((c) => {
          const fs = fsrsData[c.id]
          return !fs || fs.state === 'new'
        })

        // Primary sort: due date ascending (a new card's due date is set at
        // creation time, so this is equivalent to oldest-created-first).
        const dueDateOf = (c: Card) => fsrsData[c.id]?.dueDate ?? c.createdAt
        const sorted = [...eligible].sort((a, b) => new Date(dueDateOf(a)).getTime() - new Date(dueDateOf(b)).getTime())

        // Secondary sort: round-robin across decks, weighted by overdue severity.
        const interleaved = interleaveByDeck(sorted, (c) => c.deckId, (c) => daysOverdue(dueDateOf(c)))

        return interleaved.slice(0, remaining)
      },

      getReviewsDue: (deckId) => {
        const { cards, fsrsData, decks, folders } = get()
        const deckSet = new Set(decks.map((d) => d.id))
        const pool = (deckId ? cards.filter((c) => c.deckId === deckId) : cards)
          .filter((c) => !c.isArchived && deckSet.has(c.deckId))
        const now = new Date()

        // Collect IDs of cards pulled forward by exam deadlines
        const pulledForwardIds = new Set<string>()
        const futureExams = useExamStore.getState().exams.filter(
          (e) => new Date(e.date + 'T00:00') > now
        )
        for (const exam of futureExams) {
          const examDeckIds = new Set(getExamDeckIds(exam, decks, folders))
          const linked = pool.filter((c) => examDeckIds.has(c.deckId))
          getPulledForwardCardIds(exam, linked, fsrsData).forEach((id) =>
            pulledForwardIds.add(id)
          )
        }

        const due = pool.filter((c) => {
          if (pulledForwardIds.has(c.id)) return true
          const fs = fsrsData[c.id]
          if (!fs || fs.state === 'new') return false
          return new Date(fs.dueDate) <= now
        })

        // Primary sort: relative overdueness (days_late / scheduled_interval) descending.
        // A card 3d late on a 4d interval (0.75) outranks a card 5d late on a 200d interval
        // (0.025). Lapses break ties — more lapses first.
        const dueDateOf = (c: Card) => fsrsData[c.id]?.dueDate ?? c.createdAt
        const relativeOverdueness = (c: Card): number => {
          const fs = fsrsData[c.id]
          if (!fs || !fs.lastReviewedAt) return 0
          const msLate = Date.now() - new Date(fs.dueDate).getTime()
          const scheduled = new Date(fs.dueDate).getTime() - new Date(fs.lastReviewedAt).getTime()
          return scheduled > 0 ? msLate / scheduled : msLate / 86400000
        }
        const lapsesOf = (c: Card): number => fsrsData[c.id]?.lapses ?? 0
        const sorted = [...due].sort((a, b) => {
          const diff = relativeOverdueness(b) - relativeOverdueness(a)
          if (Math.abs(diff) > 0.001) return diff
          return lapsesOf(b) - lapsesOf(a)
        })
        return interleaveByDeck(sorted, (c) => c.deckId, (c) => daysOverdue(dueDateOf(c)))
      },

      getDueCards: (deckId) => {
        const newCards = get().getNewCards(deckId)
        const reviews = get().getReviewsDue(deckId)

        // Sort reviews by exam urgency — highest urgency first in inbox
        const { fsrsData, decks, folders } = get()
        const futureExams = useExamStore.getState().exams.filter(
          (e) => new Date(e.date + 'T00:00') > new Date()
        )
        if (futureExams.length > 0) {
          const urgencies = computeCardUrgencies(reviews, fsrsData, futureExams, decks, folders)
          reviews.sort((a, b) => (urgencies.get(b.id) ?? 0) - (urgencies.get(a.id) ?? 0))
        }

        const combined = [...reviews, ...newCards]

        // Session-start warmup: surface the 2-3 cards the learner is most
        // confident on right now, ahead of the harder overdue cards.
        return withWarmup(combined, (c) => {
          const fs = fsrsData[c.id]
          return fs && fs.state !== 'new' ? fsrsRetrievability(fs) : null
        })
      },

      // "Reviews" mode in the deck Study popup — every previously-learned
      // card in this deck, regardless of due date (early review allowed).
      getDeckReviewsAll: (deckId) => {
        const { cards, fsrsData } = get()
        const pool = cards.filter((c) => c.deckId === deckId && !c.isArchived)
        const reviewed = pool.filter((c) => {
          const fs = fsrsData[c.id]
          return !!fs && fs.state !== 'new'
        })
        const dueDateOf = (c: Card) => fsrsData[c.id]?.dueDate ?? c.createdAt
        return [...reviewed].sort((a, b) => new Date(dueDateOf(a)).getTime() - new Date(dueDateOf(b)).getTime())
      },

      // "New Cards" mode in the deck Study popup — every new card from this
      // deck, unthrottled. The daily new-card limit is an inbox-only concept
      // (see getNewCards); a manual per-deck study session deliberately
      // ignores it, the same way "deck-all" ignores due dates.
      getDeckNewAll: (deckId) => {
        const { cards, fsrsData } = get()
        const pool = cards.filter((c) => c.deckId === deckId && !c.isArchived)
        const eligible = pool.filter((c) => (fsrsData[c.id]?.state ?? 'new') === 'new')

        const dueDateOf = (c: Card) => fsrsData[c.id]?.dueDate ?? c.createdAt
        return [...eligible].sort((a, b) => new Date(dueDateOf(a)).getTime() - new Date(dueDateOf(b)).getTime())
      },

      // "Both" mode in the deck Study popup — interleaves reviews and new
      // cards from this deck, same per-type rules as the two modes above.
      getDeckBoth: (deckId) => {
        const reviews = get().getDeckReviewsAll(deckId)
        const newCards = get().getDeckNewAll(deckId)
        const result: Card[] = []
        const max = Math.max(reviews.length, newCards.length)
        for (let i = 0; i < max; i++) {
          if (i < reviews.length) result.push(reviews[i])
          if (i < newCards.length) result.push(newCards[i])
        }
        return result
      },

      getDeckCards: (deckId) => {
        return get().cards.filter((c) => c.deckId === deckId)
      },

      getFolderChildren: (folderId) => {
        return get().folders.filter((f) => f.parentId === folderId)
      },

      getDeckMastery: (deckId) => {
        const { cards, fsrsData } = get()
        const deckCards = cards.filter((c) => c.deckId === deckId)
        if (deckCards.length === 0) return 0

        const learned = deckCards.filter((c) => {
          const state = fsrsData[c.id]?.state
          return state === 'review' || state === 'relearning'
        }).length

        return Math.round((learned / deckCards.length) * 100)
      },
    }),
    {
      name: 'nemos-library',
      skipHydration: true,
      // State persisted before the `sessions`/`reviewLogs` buckets were added
      // carries a pendingDeletes object without them; the default shallow
      // merge would adopt that incomplete object wholesale, leaving the
      // missing arrays undefined and crashing the first delete that spreads
      // them. Normalize the shape on every rehydrate.
      merge: (persisted, current) => {
        const p = persisted as Partial<LibraryState> | undefined
        const pd = p?.pendingDeletes as Partial<PendingDeletes> | undefined
        return {
          ...current,
          ...p,
          pendingDeletes: {
            folders: pd?.folders ?? [],
            decks: pd?.decks ?? [],
            cards: pd?.cards ?? [],
            sessions: pd?.sessions ?? [],
            reviewLogs: pd?.reviewLogs ?? [],
          },
        }
      },
      // IDB has no practical size limit — localStorage caps at ~5–10 MB which
      // is too small for large decks (20k cards ≈ 16 MB). createIDBStorage()
      // also auto-migrates existing localStorage data on first read.
      storage: createJSONStorage(createIDBStorage),
    }
  )
)
