import { useLibraryStore } from '@/store/useLibraryStore'
import { useHistoryStore } from '@/store/useHistoryStore'
import { useNotesStore } from '@/store/useNotesStore'
import { useExamStore } from '@/store/useExamStore'
import { useTrashStore } from '@/store/useTrashStore'
import { generateId } from '@/lib/utils'
import type { Card, Note } from '@/lib/types'

const DEBUG_SYNC = false
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(id: string): boolean {
  return UUID_RE.test(id)
}

/**
 * One-time migration: early versions generated ids with
 * Math.random().toString(36) (e.g. "vv5gwqh02"), which Supabase rejects
 * because every synced column is typed uuid. Rewrites any legacy id to a
 * fresh UUID and fixes all references across the library/notes/exam stores.
 * Runs after rehydrate, before the first push. No-op when everything is
 * already a UUID.
 */
export function migrateLegacyIds(): void {
  const lib = useLibraryStore.getState()
  const hist = useHistoryStore.getState()
  const notes = useNotesStore.getState().notes
  const exams = useExamStore.getState().exams

  // Collect every legacy id that needs a new UUID
  const idMap = new Map<string, string>()
  const collect = (id: string) => {
    if (id && !isUuid(id) && !idMap.has(id)) idMap.set(id, generateId())
  }

  lib.folders.forEach((f) => collect(f.id))
  lib.decks.forEach((d) => collect(d.id))
  lib.cards.forEach((c) => collect(c.id))
  hist.sessions.forEach((s) => collect(s.id))
  hist.reviewLogs.forEach((l) => { collect(l.id); collect(l.sessionId) })
  notes.forEach((n) => collect(n.id))
  exams.forEach((e) => collect(e.id))

  // Trash restoration payloads can carry legacy ids back into the library
  const trashItems = useTrashStore.getState().items
  trashItems.forEach((t) => {
    if (t.card) collect(t.card.id)
    if (t.deck) collect(t.deck.id)
    t.deckCards?.forEach((c) => collect(c.id))
    if (t.note) collect(t.note.id)
  })

  if (idMap.size === 0) return

  const mapId = (id: string | null | undefined): string | null | undefined =>
    id ? (idMap.get(id) ?? id) : id
  const mapIds = (ids: string[]): string[] => ids.map((id) => idMap.get(id) ?? id)

  const mapCard = (c: Card): Card => ({
    ...c,
    id: mapId(c.id) as string,
    deckId: mapId(c.deckId) as string,
    linkedCardIds: mapIds(c.linkedCardIds ?? []),
    prerequisiteCardIds: mapIds(c.prerequisiteCardIds ?? []),
  })
  const mapSrsRecord = <T extends { cardId: string }>(rec: Record<string, T>): Record<string, T> => {
    const out: Record<string, T> = {}
    for (const [cardId, v] of Object.entries(rec)) {
      const newId = idMap.get(cardId) ?? cardId
      out[newId] = { ...v, cardId: newId }
    }
    return out
  }
  const mapNote = (n: Note): Note => ({
    ...n,
    id: mapId(n.id) as string,
    folderId: (mapId(n.folderId) ?? null) as string | null,
    linkedNoteIds: mapIds(n.linkedNoteIds ?? []),
    embeddedCardIds: mapIds(n.embeddedCardIds ?? []),
  })

  useLibraryStore.setState({
    folders: lib.folders.map((f) => ({
      ...f,
      id: mapId(f.id) as string,
      parentId: mapId(f.parentId) ?? null,
    })),
    decks: lib.decks.map((d) => ({
      ...d,
      id: mapId(d.id) as string,
      folderId: mapId(d.folderId) ?? null,
    })),
    cards: lib.cards.map(mapCard),
    fsrsData: mapSrsRecord(lib.fsrsData),
    // Legacy ids were never accepted by the server, so there is nothing to
    // delete remotely — keep only valid UUIDs.
    pendingDeletes: {
      folders: lib.pendingDeletes.folders.filter(isUuid),
      decks: lib.pendingDeletes.decks.filter(isUuid),
      cards: lib.pendingDeletes.cards.filter(isUuid),
      sessions: lib.pendingDeletes.sessions.filter(isUuid),
      reviewLogs: lib.pendingDeletes.reviewLogs.filter(isUuid),
    },
  })

  useHistoryStore.setState({
    sessions: hist.sessions.map((s) => ({
      ...s,
      id: mapId(s.id) as string,
      deckId: s.deckId ? (idMap.get(s.deckId) ?? s.deckId) : s.deckId,
    })),
    reviewLogs: hist.reviewLogs.map((l) => ({
      ...l,
      id: mapId(l.id) as string,
      cardId: mapId(l.cardId) as string,
      sessionId: mapId(l.sessionId) as string,
    })),
  })

  useNotesStore.setState({ notes: notes.map(mapNote) })

  useExamStore.setState({
    exams: exams.map((e) => ({
      ...e,
      id: mapId(e.id) as string,
      deckIds: mapIds(e.deckIds ?? []),
      folderIds: mapIds(e.folderIds ?? []),
    })),
  })

  useTrashStore.setState({
    items: trashItems.map((t) => ({
      ...t,
      id: mapId(t.id) as string,
      card: t.card ? mapCard(t.card) : t.card,
      cardFSRS: t.cardFSRS
        ? { ...t.cardFSRS, cardId: mapId(t.cardFSRS.cardId) as string }
        : t.cardFSRS,
      deck: t.deck
        ? { ...t.deck, id: mapId(t.deck.id) as string, folderId: (mapId(t.deck.folderId) ?? null) as string | null }
        : t.deck,
      deckCards: t.deckCards ? t.deckCards.map(mapCard) : t.deckCards,
      deckFSRS: t.deckFSRS ? mapSrsRecord(t.deckFSRS) : t.deckFSRS,
      note: t.note ? mapNote(t.note) : t.note,
    })),
  })

  if (DEBUG_SYNC) console.log(`[SYNC] migrateLegacyIds: rewrote ${idMap.size} legacy id(s) to UUIDs`)
}
