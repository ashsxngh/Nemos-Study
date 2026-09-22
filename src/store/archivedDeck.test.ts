/**
 * Archiving has exactly one scheduling effect: it stops new cards being
 * introduced. It must never pull already-scheduled cards out of spaced
 * repetition.
 *
 * Archiving is INHERITED down the folder tree — a deck inside an archived
 * folder is archived too, at any depth — and nothing un-archives implicitly:
 * each item keeps its own flag, so unarchiving a folder restores only the
 * items that were archived by inheritance.
 *
 * The second half is the easy thing to get wrong — "archived" reads like
 * "inactive", and a blanket `!deck.isArchived` filter in the due path would
 * silently freeze a learner's real review history. These tests exist to fail
 * loudly if someone adds one. If one of these fails, the fix is to your change.
 *
 * Note: card-level `isArchived` (leech auto-suspend, `useLibraryStore.ts`) is a
 * DIFFERENT flag and does remove the card from both queues — see the last test.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { useLibraryStore } from '@/store/useLibraryStore'
import { archivedDeckIds, archivedFolderIds } from '@/lib/archive'

// See sameDayGraduation.test.ts — zustand persist writes through IndexedDB,
// which does not exist in the node test environment.
beforeAll(() => {
  ;(globalThis as unknown as { indexedDB: unknown }).indexedDB = { open: () => ({}) }
})

const L = () => useLibraryStore.getState()
const ids = (cs: { id: string }[]) => cs.map((c) => c.id)

/** A card already in review state and due today, with no log for today. */
function makeScheduledCard(deckId: string) {
  const card = L().createCard(deckId, 'front', 'back')
  L().setFSRSData(card.id, {
    ...L().fsrsData[card.id],
    state: 'review',
    stability: 10,
    difficulty: 5,
    repetitions: 3,
    dueDate: new Date().toISOString(),
    lastReviewedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
  })
  return card
}

describe('archived decks', () => {
  it('stops introducing new cards once the deck is archived', () => {
    const deck = L().createDeck('ArchivedNew')
    const card = L().createCard(deck.id, 'front', 'back')

    // Active deck — the new card is queued, deck-scoped and globally.
    expect(ids(L().getNewCards(deck.id))).toContain(card.id)
    expect(ids(L().getNewCards())).toContain(card.id)
    expect(ids(L().getDueCards())).toContain(card.id)

    L().updateDeck(deck.id, { isArchived: true })

    // Archived — never introduced for first-time study again.
    expect(ids(L().getNewCards(deck.id))).not.toContain(card.id)
    expect(ids(L().getNewCards())).not.toContain(card.id)
    expect(ids(L().getDueCards())).not.toContain(card.id)

    // Unarchiving restores it — archiving is a pause, not a deletion.
    L().updateDeck(deck.id, { isArchived: false })
    expect(ids(L().getNewCards(deck.id))).toContain(card.id)
  })

  it('keeps already-scheduled cards in Reviews — archiving never leaves the SRS', () => {
    const deck = L().createDeck('ArchivedReviews')
    const card = makeScheduledCard(deck.id)

    expect(ids(L().getReviewsDue(deck.id))).toContain(card.id)
    expect(L().getDeckDueCount(deck.id)).toBe(1)

    L().updateDeck(deck.id, { isArchived: true })

    // ⚠️ INTENTIONAL and load-bearing: still due, still answerable, still counted.
    expect(ids(L().getReviewsDue(deck.id))).toContain(card.id)
    expect(ids(L().getReviewsDue())).toContain(card.id)
    expect(ids(L().getDueCards(deck.id))).toContain(card.id)
    expect(L().getDeckDueCount(deck.id)).toBe(1)
  })

  it('archiving a deck mid-life keeps its learned cards and drops only its unlearned ones', () => {
    const deck = L().createDeck('ArchivedMixed')
    const learned = makeScheduledCard(deck.id)
    const fresh = L().createCard(deck.id, 'fresh-front', 'fresh-back')

    L().updateDeck(deck.id, { isArchived: true })

    const queue = ids(L().getDueCards(deck.id))
    expect(queue).toContain(learned.id)
    expect(queue).not.toContain(fresh.id)
  })

  it('card-level isArchived is a separate flag and removes the card from both queues', () => {
    const deck = L().createDeck('ArchivedCard')
    const scheduled = makeScheduledCard(deck.id)
    const fresh = L().createCard(deck.id, 'fresh-front', 'fresh-back')

    L().updateCard(scheduled.id, { isArchived: true })
    L().updateCard(fresh.id, { isArchived: true })

    expect(ids(L().getReviewsDue(deck.id))).not.toContain(scheduled.id)
    expect(ids(L().getNewCards(deck.id))).not.toContain(fresh.id)
  })
})

describe('archived folders cascade to their decks', () => {
  it('a deck inside an archived folder is archived, at any depth', () => {
    const top = L().createFolder('Top')
    const mid = L().createFolder('Mid', top.id)
    const deep = L().createDeck('Deep', mid.id)
    const card = L().createCard(deep.id, 'front', 'back')

    expect(ids(L().getNewCards(deep.id))).toContain(card.id)

    L().updateDeck(deep.id, { isArchived: false })
    L().updateFolder(top.id, { isArchived: true })

    // The deck's own flag is still false — it is archived by inheritance.
    expect(L().decks.find((d) => d.id === deep.id)!.isArchived).toBe(false)
    expect(L().getArchivedDeckIds().has(deep.id)).toBe(true)
    expect(ids(L().getNewCards(deep.id))).not.toContain(card.id)
    expect(ids(L().getNewCards())).not.toContain(card.id)
  })

  it('reviews keep running for a deck archived via its folder', () => {
    const folder = L().createFolder('ArchivedParent')
    const deck = L().createDeck('Inherited', folder.id)
    const card = makeScheduledCard(deck.id)

    L().updateFolder(folder.id, { isArchived: true })

    // Same invariant as a directly-archived deck: scheduling is untouched.
    expect(ids(L().getReviewsDue(deck.id))).toContain(card.id)
    expect(ids(L().getReviewsDue())).toContain(card.id)
    expect(L().getDeckDueCount(deck.id)).toBe(1)
  })

  it('unarchiving the folder restores inherited decks but not individually archived ones', () => {
    const folder = L().createFolder('Mixed')
    const inherited = L().createDeck('Inherited', folder.id)
    const explicit = L().createDeck('Explicit', folder.id)
    const a = L().createCard(inherited.id, 'a-front', 'a-back')
    const b = L().createCard(explicit.id, 'b-front', 'b-back')

    L().updateDeck(explicit.id, { isArchived: true })
    L().updateFolder(folder.id, { isArchived: true })
    expect(ids(L().getNewCards())).not.toContain(a.id)
    expect(ids(L().getNewCards())).not.toContain(b.id)

    L().updateFolder(folder.id, { isArchived: false })

    // Only the inherited one comes back — the explicit archive is preserved,
    // because a parent never overwrites a child's own flag.
    expect(ids(L().getNewCards())).toContain(a.id)
    expect(ids(L().getNewCards())).not.toContain(b.id)
  })
})

describe('archive inheritance helper', () => {
  const folder = (id: string, parentId: string | null, isArchived: boolean) =>
    ({ id, parentId, isArchived }) as Parameters<typeof archivedFolderIds>[0][number]
  const deck = (id: string, folderId: string | null, isArchived: boolean) =>
    ({ id, folderId, isArchived }) as Parameters<typeof archivedDeckIds>[0][number]

  it('walks the whole ancestor chain', () => {
    const folders = [folder('a', null, true), folder('b', 'a', false), folder('c', 'b', false)]
    expect([...archivedFolderIds(folders)].sort()).toEqual(['a', 'b', 'c'])
    expect(archivedDeckIds([deck('d', 'c', false)], folders).has('d')).toBe(true)
  })

  it('survives a corrupted tree without hanging', () => {
    // A parent cycle and an orphaned parent id must not recurse forever.
    const folders = [folder('x', 'y', false), folder('y', 'x', false), folder('z', 'gone', false)]
    expect(archivedFolderIds(folders).size).toBe(0)
    expect(archivedDeckIds([deck('d', 'z', false)], folders).size).toBe(0)
  })

  it('a deck at library root is unaffected by any archived folder', () => {
    const folders = [folder('a', null, true)]
    expect(archivedDeckIds([deck('root-deck', null, false)], folders).size).toBe(0)
  })
})
