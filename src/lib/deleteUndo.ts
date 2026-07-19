import { useLibraryStore } from '@/store/useLibraryStore'
import { useTrashStore } from '@/store/useTrashStore'
import { useHistoryStore } from '@/store/useHistoryStore'
import { fsrsBackfillCard } from '@/lib/srs'
import type { Card, ReviewLog } from '@/lib/types'

const UNDO_WINDOW_MS = 5000

/**
 * Restores previously-trashed cards back into the library store. Prefers the
 * trash entry's snapshot (FSRS state as it was at delete time); falls back
 * to a caller-supplied in-memory card when the trash entry is already gone
 * (e.g. undo fires right as the entry gets purged elsewhere).
 */
export function restoreCardsFromTrash(ids: string[], fallbackCards?: Map<string, Card>): void {
  const trash = useTrashStore.getState()
  // Logs pruned when these cards were deleted, so undo puts history back rather
  // than leaving it lost (removed locally) and still queued for server delete.
  const logsToRestore: ReviewLog[] = []
  const restoredLogIds = new Set<string>()
  useLibraryStore.setState((s) => {
    const newCards = [...s.cards]
    const newFsrsData = { ...s.fsrsData }
    const restoredIds = new Set<string>()
    for (const id of ids) {
      const entry = trash.items.find((i) => i.id === id && i.type === 'card')
      const card = entry?.card ?? fallbackCards?.get(id)
      if (!card) continue
      newCards.push(card)
      // Never restore a card without an fsrs entry — a missing snapshot (or
      // the fallbackCards path, which carries no FSRS at all) previously left
      // the card with no scheduling row, so it never synced one and
      // misclassified as "new" everywhere.
      newFsrsData[id] = entry?.cardFSRS ?? newFsrsData[id] ?? fsrsBackfillCard(id, card.userId)
      for (const l of entry?.cardLogs ?? []) {
        logsToRestore.push(l)
        restoredLogIds.add(l.id)
      }
      restoredIds.add(id)
    }
    return {
      cards: newCards,
      fsrsData: newFsrsData,
      pendingDeletes: {
        ...s.pendingDeletes,
        cards: s.pendingDeletes.cards.filter((id) => !restoredIds.has(id)),
        // Cancel the queued server-side deletion of these cards' logs.
        reviewLogs: (s.pendingDeletes.reviewLogs ?? []).filter((lid) => !restoredLogIds.has(lid)),
      },
    }
  })
  useHistoryStore.getState().restoreReviewLogs(logsToRestore)
  for (const id of ids) {
    const entry = trash.items.find((i) => i.id === id && i.type === 'card')
    if (entry) trash.remove(entry.id)
  }
}

/**
 * Generic "delete, then a few seconds to undo" tracker. Call `track(payload)`
 * right after deleting; call `consume()` from the Undo action (toast click or
 * Ctrl+Z) to get the payload back, or `null` if the window already elapsed.
 * Shared by DeckView's card delete (bulk or single) and the study session's
 * quick-delete (`D` key) — both need the same "remember what I just deleted
 * for a few seconds" bookkeeping, just with different payload shapes (a list
 * of ids vs. a single card + its queue position).
 */
export function createUndoTracker<T>(windowMs: number = UNDO_WINDOW_MS) {
  let pending: T | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    track(payload: T) {
      pending = payload
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { pending = null }, windowMs)
    },
    consume(): T | null {
      if (pending === null) return null
      if (timer) clearTimeout(timer)
      const payload = pending
      pending = null
      return payload
    },
    peek(): T | null {
      return pending
    },
  }
}
