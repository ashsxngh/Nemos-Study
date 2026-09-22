/**
 * Same-day graduation is a hard, permanent product requirement: a card learned
 * today MUST graduate into Reviews the same day, be visible and answerable
 * that day, and only stop counting as due once it has actually been answered
 * as a review.
 *
 * This suite is the guard rail. It exists because the once-per-day
 * `answeredToday` rule (added to make the Reviews counter decrement on wrong
 * answers) was applied uniformly and silently swallowed a card's first
 * exposure, so a newly-learned card disappeared from the app for the rest of
 * the day. If you are touching due/queue gating and one of these fails, the
 * fix is to your change — not to this file.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { useLibraryStore } from '@/store/useLibraryStore'
import { useHistoryStore } from '@/store/useHistoryStore'

// zustand's persist middleware writes through IndexedDB, absent in the node
// test environment. A shim whose request never fires keeps those writes from
// raising unhandled rejections; this suite only exercises in-memory logic.
beforeAll(() => {
  ;(globalThis as unknown as { indexedDB: unknown }).indexedDB = { open: () => ({}) }
})

const L = () => useLibraryStore.getState()
const ids = (cs: { id: string }[]) => cs.map((c) => c.id)

describe('same-day graduation', () => {
  it('a new card learned today graduates into Reviews today, is answerable, then clears once answered', () => {
    const deck = L().createDeck('SameDay')
    const card = L().createCard(deck.id, 'front', 'back')

    // Brand new — in New Cards, not in Reviews.
    expect(ids(L().getNewCards(deck.id))).toContain(card.id)
    expect(ids(L().getReviewsDue(deck.id))).not.toContain(card.id)
    expect(L().getDeckNewCount(deck.id)).toBe(1)
    expect(L().getDeckDueCount(deck.id)).toBe(0)

    // Learn it — first exposure out of New Cards, "Remembered" = Good (3).
    L().reviewCard(card.id, 3, 1000, 'session-1')

    // It has left New Cards…
    expect(L().fsrsData[card.id].state).not.toBe('new')
    expect(ids(L().getNewCards(deck.id))).not.toContain(card.id)
    expect(L().getDeckNewCount(deck.id)).toBe(0)

    // …and MUST now be in Reviews today, visible and answerable everywhere.
    expect(ids(L().getReviewsDue(deck.id))).toContain(card.id)
    expect(ids(L().getReviewsDue())).toContain(card.id)
    expect(ids(L().getDueCards(deck.id))).toContain(card.id)
    expect(L().getDeckDueCount(deck.id)).toBe(1)

    // Answer it once as a review (wasNew === false).
    L().reviewCard(card.id, 3, 1000, 'session-1')
    expect(
      useHistoryStore.getState().reviewLogs.filter((l) => l.cardId === card.id).map((l) => l.wasNew)
    ).toEqual([true, false])

    // Only now does it stop re-counting as due for the rest of today.
    expect(ids(L().getReviewsDue(deck.id))).not.toContain(card.id)
    expect(ids(L().getDueCards(deck.id))).not.toContain(card.id)
    expect(L().getDeckDueCount(deck.id)).toBe(0)
  })

  it('a wrong answer still clears the card for today (once-per-day rule preserved)', () => {
    const deck = L().createDeck('Missed')
    const card = L().createCard(deck.id, 'front', 'back')
    L().reviewCard(card.id, 3, 1000, 's')  // first exposure — graduates
    L().reviewCard(card.id, 1, 1000, 's')  // Missed in Reviews — re-dues sub-day

    // Sub-day step puts it back due today, but it was answered — stay cleared.
    expect(L().fsrsData[card.id].state).not.toBe('new')
    expect(ids(L().getReviewsDue(deck.id))).not.toContain(card.id)
    expect(L().getDeckDueCount(deck.id)).toBe(0)
  })

  it('an ordinary review card answered today stays suppressed even with no logs', () => {
    const deck = L().createDeck('Ordinary')
    const card = L().createCard(deck.id, 'front', 'back')
    // A card already in review state, due today, reviewed today, but with no
    // review log at all (e.g. logs not yet pulled on this device). Absent
    // positive evidence of a first exposure today, it must stay suppressed.
    L().setFSRSData(card.id, {
      ...L().fsrsData[card.id],
      state: 'review',
      stability: 10,
      difficulty: 5,
      repetitions: 3,
      dueDate: new Date().toISOString(),
      lastReviewedAt: new Date().toISOString(),
    })
    expect(ids(L().getReviewsDue(deck.id))).not.toContain(card.id)
    expect(L().getDeckDueCount(deck.id)).toBe(0)
  })
})
