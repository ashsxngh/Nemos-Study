/**
 * The full learning lifecycle with EMPTY learning/relearning steps.
 *
 *   Day 0, New Cards: first answer → graduates straight to 'review', leaves New.
 *   Day 0, Reviews:   the same card is in today's Reviews (queue + badges)
 *                     regardless of its tomorrow+ dueDate, is answerable, and
 *                     drops out once answered.
 *   Then:             each "Remembered" on its due date compounds per FSRS.
 *
 * Every interval is checked against a bare ts-fsrs replay of the same ratings
 * at the same instants (fuzz on, same params), so this proves the store adds no
 * scheduling of its own. Companion to sameDayGraduation.test.ts.
 */

process.env.TZ = 'Australia/Sydney'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { fsrs, generatorParameters, Rating } from 'ts-fsrs'
import type { Card as FsrsCard, Grade } from 'ts-fsrs'
import { useLibraryStore } from '@/store/useLibraryStore'
import { useHistoryStore } from '@/store/useHistoryStore'
import { useSettingsStore } from '@/store/useSettingsStore'
import { toFsrsCard } from '@/lib/srs'

beforeAll(() => {
  ;(globalThis as unknown as { indexedDB: unknown }).indexedDB = { open: () => ({}) }
  vi.useFakeTimers({ toFake: ['Date'] })
})
afterAll(() => {
  vi.useRealTimers()
})

const L = () => useLibraryStore.getState()
const ids = (cs: { id: string }[]) => cs.map((c) => c.id)
const DAY = 86400000

/** Local (Sydney) wall-clock instant. Month is 1-based. */
const local = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min)

function referenceScheduler() {
  const s = useSettingsStore.getState()
  return fsrs(
    generatorParameters({
      w: s.fsrsWeights,
      request_retention: s.fsrsTargetRetention,
      maximum_interval: s.fsrsMaxInterval,
      enable_fuzz: true,
      enable_short_term: true,
      learning_steps: [],
      relearning_steps: [],
    }),
  )
}

type R = 1 | 3
const SCENARIOS: { name: string; first: R; second: R }[] = [
  { name: 'R/R', first: 3, second: 3 },
  { name: 'F/R', first: 1, second: 3 },
  { name: 'R/F', first: 3, second: 1 },
]

/** Printed at the end so the gap sequences show up in the test output. */
const report: string[] = []
afterAll(() => {
  console.log('\nGap sequences (days):\n' + report.join('\n'))
})

describe.each([0.95, 0.9])('learning lifecycle at target_retention %s', (retention) => {
  for (const { name, first, second } of SCENARIOS) {
    it(`${name}: graduates on first answer, same-day Reviews answer, then compounds`, () => {
      useSettingsStore.setState({ fsrsTargetRetention: retention })
      const ref = referenceScheduler()

      vi.setSystemTime(local(2026, 10, 1, 8, 0))
      const deck = L().createDeck(`LC ${retention} ${name}`)
      const card = L().createCard(deck.id, 'front', 'back')
      let refCard: FsrsCard = toFsrsCard(L().fsrsData[card.id])
      const step = (at: Date, grade: R) => {
        vi.setSystemTime(at)
        L().reviewCard(card.id, grade, 1000, 's')
        refCard = ref.next(refCard, at, grade as Grade).card
        const fs = L().fsrsData[card.id]
        expect(new Date(fs.dueDate).getTime()).toBe(refCard.due.getTime())
        expect(fs.stability).toBe(refCard.stability)
        expect(fs.difficulty).toBe(refCard.difficulty)
        return Math.round((new Date(fs.dueDate).getTime() - at.getTime()) / DAY)
      }

      expect(ids(L().getNewCards(deck.id))).toContain(card.id)

      // 09:00 — first answer, in New Cards.
      step(local(2026, 10, 1, 9, 0), first)
      expect(L().fsrsData[card.id].state).toBe('review')
      expect(L().fsrsData[card.id].learningSteps).toBe(0)
      expect(ids(L().getNewCards(deck.id))).not.toContain(card.id)
      expect(ids(L().getReviewsDue(deck.id))).toContain(card.id)
      expect(ids(L().getDueCards(deck.id))).toContain(card.id)
      expect(L().getDeckDueCount(deck.id)).toBe(1)
      expect(L().getDueTodayIds(deck.id).has(card.id)).toBe(true)

      // 09:15 — same-day answer in Reviews.
      const gaps = [step(local(2026, 10, 1, 9, 15), second)]
      expect(L().fsrsData[card.id].state).toBe('review') // never relearning
      expect(ids(L().getReviewsDue(deck.id))).not.toContain(card.id)
      expect(L().getDeckDueCount(deck.id)).toBe(0)

      // 22:00 — still gone for the rest of today.
      vi.setSystemTime(local(2026, 10, 1, 22, 0))
      expect(ids(L().getReviewsDue(deck.id))).not.toContain(card.id)
      expect(ids(L().getDueCards(deck.id))).not.toContain(card.id)
      expect(L().getDeckDueCount(deck.id)).toBe(0)

      // Then "Remembered" on each due date, three times.
      for (let i = 0; i < 3; i++) {
        const due = new Date(L().fsrsData[card.id].dueDate)
        vi.setSystemTime(due)
        expect(ids(L().getReviewsDue(deck.id))).toContain(card.id)
        expect(L().getDeckDueCount(deck.id)).toBe(1)
        gaps.push(step(due, 3))
        expect(ids(L().getReviewsDue(deck.id))).not.toContain(card.id)
      }

      report.push(`  ${retention}  ${name}: ${gaps.join(' → ')}`)
      if (name === 'R/R') {
        // The point of the change: no day-1 repeat after a correct same-day answer.
        expect(gaps[0]).toBeGreaterThanOrEqual(retention === 0.95 ? 2 : 3)
      }
      for (const g of gaps) expect(g).toBeGreaterThanOrEqual(1)
    })
  }
})

describe('same-day graduation fallback (review_logs lag)', () => {
  it('a card with repetitions 1, reviewed today, but NO logs is in today\'s Reviews', () => {
    vi.setSystemTime(local(2026, 10, 2, 10, 0))
    const deck = L().createDeck('Lag')
    const card = L().createCard(deck.id, 'front', 'back')
    // Exactly what a second device holds when fsrs_data arrived before the
    // first-exposure review_log: a graduated row, due tomorrow, no log.
    L().setFSRSData(card.id, {
      ...L().fsrsData[card.id],
      state: 'review',
      stability: 2,
      difficulty: 5,
      repetitions: 1,
      lastReviewedAt: local(2026, 10, 2, 9, 0).toISOString(),
      dueDate: local(2026, 10, 3, 9, 0).toISOString(),
    })
    expect(useHistoryStore.getState().reviewLogs.some((l) => l.cardId === card.id)).toBe(false)
    expect(ids(L().getReviewsDue(deck.id))).toContain(card.id)
    expect(L().getDeckDueCount(deck.id)).toBe(1)
  })
})

describe('undo (session snapshot restore)', () => {
  // Mirrors handleUndo in study/session/page.tsx: restore the pre-review
  // snapshot, then drop the last log.
  const undo = (cardId: string, prev: ReturnType<typeof L>['fsrsData'][string]) => {
    L().setFSRSData(cardId, prev)
    useHistoryStore.getState().removeLastLog()
  }

  it('undoing a first exposure puts the card back in New Cards and out of Reviews', () => {
    vi.setSystemTime(local(2026, 10, 3, 9, 0))
    const deck = L().createDeck('UndoNew')
    const card = L().createCard(deck.id, 'front', 'back')
    const prev = L().fsrsData[card.id]
    L().reviewCard(card.id, Rating.Good, 1000, 's')
    expect(ids(L().getReviewsDue(deck.id))).toContain(card.id)

    undo(card.id, prev)
    expect(L().fsrsData[card.id].state).toBe('new')
    expect(ids(L().getNewCards(deck.id))).toContain(card.id)
    expect(ids(L().getReviewsDue(deck.id))).not.toContain(card.id)
    expect(L().getDeckDueCount(deck.id)).toBe(0)
  })

  it('undoing the same-day Reviews answer puts the card back in today\'s Reviews', () => {
    vi.setSystemTime(local(2026, 10, 3, 9, 0))
    const deck = L().createDeck('UndoReview')
    const card = L().createCard(deck.id, 'front', 'back')
    L().reviewCard(card.id, Rating.Good, 1000, 's')
    vi.setSystemTime(local(2026, 10, 3, 9, 15))
    const prev = L().fsrsData[card.id]
    L().reviewCard(card.id, Rating.Good, 1000, 's')
    expect(ids(L().getReviewsDue(deck.id))).not.toContain(card.id)

    undo(card.id, prev)
    expect(L().fsrsData[card.id].state).toBe('review')
    expect(ids(L().getReviewsDue(deck.id))).toContain(card.id)
    expect(L().getDeckDueCount(deck.id)).toBe(1)
  })
})
