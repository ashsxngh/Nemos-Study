'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client'
import { useLibraryStore } from '@/store/useLibraryStore'
import { useNotesStore } from '@/store/useNotesStore'
import { migrateLegacyIds } from '@/lib/migrateLegacyIds'
import type {
  Folder,
  Deck,
  Card,
  SRSData,
  ReviewSession,
  ReviewLog,
  Note,
} from '@/lib/types'

// ─── Case converters ──────────────────────────────────────────────────────────

type PlainObject = Record<string, unknown>

function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}

function camelToSnake(str: string): string {
  return str.replace(/([A-Z])/g, (c: string) => '_' + c.toLowerCase())
}

function toCamel(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(toCamel)
  if (obj !== null && typeof obj === 'object') {
    const result: PlainObject = {}
    for (const [k, v] of Object.entries(obj as PlainObject)) {
      result[snakeToCamel(k)] = toCamel(v)
    }
    return result
  }
  return obj
}

function toSnake(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(toSnake)
  if (obj !== null && typeof obj === 'object') {
    const result: PlainObject = {}
    for (const [k, v] of Object.entries(obj as PlainObject)) {
      // Skip computed helper fields (prefixed with _)
      if (k.startsWith('_')) continue
      result[camelToSnake(k)] = toSnake(v)
    }
    return result
  }
  return obj
}

// ─── Realtime-pending tracker (for insert echo dedup only) ───────────────────

const realtimePending = {
  folders:    new Set<string>(),
  decks:      new Set<string>(),
  cards:      new Set<string>(),
  reviewLogs: new Set<string>(),
  notes:      new Set<string>(),
}

// Merge server rows with local rows, always keeping local-only items.
// Local-only items are cards/decks/etc that were created locally but haven't
// been pushed to Supabase yet (e.g. created within the debounce window before reload).
// Server wins for any item that exists on both sides.
function mergeKeepLocal<T extends { id: string }>(
  serverRows: T[],
  currentRows: T[],
): T[] {
  const serverMap = new Map(serverRows.map((r) => [r.id, r]))
  const localOnly = currentRows.filter((r) => !serverMap.has(r.id))
  if (localOnly.length > 0) {
    console.log(`[SYNC] mergeKeepLocal: preserving ${localOnly.length} local-only item(s)`, localOnly.map(r => r.id))
  }
  return [...serverRows, ...localOnly]
}

// ─── Pull ─────────────────────────────────────────────────────────────────────

async function pullFromSupabase(): Promise<void> {
  if (!isSupabaseConfigured()) return
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return


  const [
    foldersRes,
    decksRes,
    cardsRes,
    srsRes,
    sessionsRes,
    logsRes,
    notesRes,
  ] = await Promise.all([
    supabase.from('folders').select('*').eq('user_id', user.id),
    supabase.from('decks').select('*').eq('user_id', user.id),
    supabase.from('cards').select('*').eq('user_id', user.id),
    supabase.from('srs_data').select('*').eq('user_id', user.id),
    supabase.from('review_sessions').select('*').eq('user_id', user.id),
    supabase.from('review_logs').select('*').eq('user_id', user.id),
    supabase.from('notes').select('*').eq('user_id', user.id),
  ])

  // Filter out anything that's locally queued for deletion so a pull never
  // resurrects an item the user just deleted before the push debounce fired.
  const { pendingDeletes } = useLibraryStore.getState()
  const pendingFolderSet = new Set(pendingDeletes.folders)
  const pendingDeckSet   = new Set(pendingDeletes.decks)
  const pendingCardSet   = new Set(pendingDeletes.cards)

  const folders = (foldersRes.data ?? [])
    .map((r) => toCamel(r) as Folder)
    .filter((f) => !pendingFolderSet.has(f.id))
  const decks = (decksRes.data ?? [])
    .map((r) => toCamel(r) as Deck)
    .filter((d) => !pendingDeckSet.has(d.id))
  const cards = (cardsRes.data ?? [])
    .map((r) => toCamel(r) as Card)
    .filter((c) => !pendingCardSet.has(c.id))
  const sessions = (sessionsRes.data ?? []).map((r) => toCamel(r) as ReviewSession)
  const reviewLogs = (logsRes.data  ?? []).map((r) => toCamel(r) as ReviewLog)
  const notes   = (notesRes.data   ?? []).map((r) => toCamel(r) as Note)


  // srsData is stored as a Record<cardId, SRSData> in the store.
  // Only keep entries for cards that survived the pending-delete filter — this
  // prevents orphaned srs_data rows (for deleted deck cards) from being pulled
  // back in and later re-upserted to Supabase on the next push.
  const survivingCardSet = new Set(cards.map((c) => c.id))
  const srsData: Record<string, SRSData> = {}
  for (const row of srsRes.data ?? []) {
    const s = toCamel(row) as SRSData
    if (!pendingCardSet.has(s.cardId) && survivingCardSet.has(s.cardId)) {
      srsData[s.cardId] = s
    }
  }

  useLibraryStore.setState((current) => {
    const mergedDecks = mergeKeepLocal(decks, current.decks)
    const mergedDeckSet = new Set(mergedDecks.map((d) => d.id))

    // Remove cards whose deck no longer exists — these are orphans left behind
    // when a deck was deleted but its cards survived in Supabase or local state.
    const rawMergedCards = mergeKeepLocal(cards, current.cards)
    const orphanCardIds = rawMergedCards
      .filter((c) => !mergedDeckSet.has(c.deckId))
      .map((c) => c.id)
    const mergedCards = orphanCardIds.length > 0
      ? rawMergedCards.filter((c) => mergedDeckSet.has(c.deckId))
      : rawMergedCards
    if (orphanCardIds.length > 0) {
      console.log(
        '[SYNC] pullFromSupabase: removing', orphanCardIds.length,
        'orphan card(s) with no matching deck, queuing for remote delete',
      )
    }

    const mergedCardSet = new Set(mergedCards.map((c) => c.id))
    const newOrphanIds = orphanCardIds.filter(
      (id) => !current.pendingDeletes.cards.includes(id),
    )

    return {
      folders:    mergeKeepLocal(folders, current.folders),
      decks:      mergedDecks,
      cards:      mergedCards,
      // Strip srsData entries for cards that aren't in the final merged set.
      // This cleans up orphans from deleted decks that survived in Supabase.
      srsData: Object.fromEntries(
        Object.entries({ ...current.srsData, ...srsData }).filter(([id]) => mergedCardSet.has(id))
      ),
      // Strip fsrsData entries for removed/orphan cards (fsrsData is local-only,
      // so deleteDeck cleans it on delete, but orphans re-introduced via pull need this).
      fsrsData: Object.fromEntries(
        Object.entries(current.fsrsData).filter(([id]) => mergedCardSet.has(id))
      ),
      sessions,
      reviewLogs: mergeKeepLocal(reviewLogs, current.reviewLogs),
      ...(newOrphanIds.length > 0 ? {
        pendingDeletes: {
          ...current.pendingDeletes,
          cards: [...current.pendingDeletes.cards, ...newOrphanIds],
        },
      } : {}),
    }
  })
  useNotesStore.setState((current) => ({
    notes: mergeKeepLocal(notes, current.notes),
  }))


  realtimePending.folders.clear()
  realtimePending.decks.clear()
  realtimePending.cards.clear()
  realtimePending.reviewLogs.clear()
  realtimePending.notes.clear()
}

// ─── Push helpers ─────────────────────────────────────────────────────────────

async function pushToSupabase(
  folders: Folder[],
  decks: Deck[],
  cards: Card[],
  srsData: Record<string, SRSData>,
  sessions: ReviewSession[],
  pendingDeletes?: { folders: string[], decks: string[], cards: string[] },
): Promise<void> {
  if (!isSupabaseConfigured()) {
    console.warn('[SYNC] pushToSupabase: Supabase not configured, skipping push')
    return
  }
  const supabase = createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError) {
    console.error('[SYNC] pushToSupabase: auth error', authError)
    throw new Error(`Auth error: ${authError.message}`)
  }
  if (!user) {
    console.warn('[SYNC] pushToSupabase: no authenticated user, skipping push')
    return
  }

  const upsertOpts = { onConflict: 'id' } as const
  const withUserId = (r: unknown) => ({ ...(toSnake(r) as PlainObject), user_id: user.id })

  // PostgREST sends .in() filters as URL query params — large arrays exceed
  // server URL-length limits (~8KB). Batch deletes to stay well under that.
  const BATCH = 100

  console.log('[SYNC] pushToSupabase: upserting to Supabase as user', user.id, {
    folders: folders.length,
    decks: decks.length,
    cards: cards.length,
    srsData: Object.keys(srsData).length,
    sessions: sessions.length,
  })

  // Only upsert srs_data for cards that exist in the active card set.
  // This prevents orphaned entries (e.g. from a deleted deck whose cards were
  // briefly re-pulled from Supabase before the delete push ran) from being
  // written back. Also excludes cards about to be deleted to avoid a deadlock
  // (upsert + delete on the same row in the same push → PostgreSQL 40P01).
  const activeCardSet  = new Set(cards.map((c) => c.id))
  const cardDeleteSet  = new Set(pendingDeletes?.cards ?? [])
  const srsToUpsert = Object.values(srsData).filter(
    (s) => activeCardSet.has(s.cardId) && !cardDeleteSet.has(s.cardId)
  )

  // Upsert in batches — large payloads can exceed PostgREST body/row limits.
  async function upsertBatched<T>(
    table: 'folders' | 'decks' | 'cards' | 'srs_data' | 'review_sessions',
    rows: T[],
    opts: { onConflict: string },
  ): Promise<void> {
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH)
      const res = await supabase.from(table).upsert(chunk as never[], opts)
      if (res.error) {
        console.error(`[SYNC] pushToSupabase: upsert error on "${table}" (batch ${i / BATCH}):`, res.error)
        throw new Error(`${table}: ${res.error.message} (code ${res.error.code})`)
      }
    }
  }

  await Promise.all([
    folders.length
      ? upsertBatched('folders', folders.map(withUserId), upsertOpts)
      : null,
    decks.length
      ? upsertBatched('decks', decks.map(withUserId), upsertOpts)
      : null,
    cards.length
      ? upsertBatched(
          'cards',
          cards.map((c) => withUserId({ ...c, hint: c.hint ?? '', front: c.front ?? '', back: c.back ?? '' })),
          upsertOpts,
        )
      : null,
    srsToUpsert.length
      ? upsertBatched('srs_data', srsToUpsert.map(withUserId), { onConflict: 'card_id' })
      : null,
    sessions.length
      ? upsertBatched('review_sessions', sessions.map(withUserId), upsertOpts)
      : null,
  ])

  console.log('[SYNC] pushToSupabase: all upserts succeeded')

  // Execute pending deletes — cards/srs first, then decks, then folders
  // so child rows are gone before their parents (avoids any implicit ordering issues).
  // Each delete is batched: .in() with hundreds of IDs exceeds PostgREST's URL
  // length limit and returns "Bad Request".
  if (pendingDeletes) {
    if (pendingDeletes.cards.length) {
      for (let i = 0; i < pendingDeletes.cards.length; i += BATCH) {
        const chunk = pendingDeletes.cards.slice(i, i + BATCH)
        const delCards = await supabase.from('cards').delete().in('id', chunk)
        if (delCards.error) {
          console.error('[SYNC] pushToSupabase: cards delete error', delCards.error)
          throw new Error(`cards delete: ${delCards.error.message} (code ${delCards.error.code})`)
        }
        const delSrs = await supabase.from('srs_data').delete().in('card_id', chunk)
        if (delSrs.error) {
          console.error('[SYNC] pushToSupabase: srs_data delete error', delSrs.error)
          throw new Error(`srs_data delete: ${delSrs.error.message} (code ${delSrs.error.code})`)
        }
      }
    }
    if (pendingDeletes.decks.length) {
      for (let i = 0; i < pendingDeletes.decks.length; i += BATCH) {
        const chunk = pendingDeletes.decks.slice(i, i + BATCH)
        const delDecks = await supabase.from('decks').delete().in('id', chunk)
        if (delDecks.error) {
          console.error('[SYNC] pushToSupabase: decks delete error', delDecks.error)
          throw new Error(`decks delete: ${delDecks.error.message} (code ${delDecks.error.code})`)
        }
      }
    }
    if (pendingDeletes.folders.length) {
      for (let i = 0; i < pendingDeletes.folders.length; i += BATCH) {
        const chunk = pendingDeletes.folders.slice(i, i + BATCH)
        const delFolders = await supabase.from('folders').delete().in('id', chunk)
        if (delFolders.error) {
          console.error('[SYNC] pushToSupabase: folders delete error', delFolders.error)
          throw new Error(`folders delete: ${delFolders.error.message} (code ${delFolders.error.code})`)
        }
      }
    }
    if (pendingDeletes.folders.length || pendingDeletes.decks.length || pendingDeletes.cards.length) {
      console.log('[SYNC] pushToSupabase: deletes complete')
    }
  }
}

async function pushNotesToSupabase(notes: Note[]): Promise<void> {
  if (!isSupabaseConfigured()) return
  const supabase = createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError) throw new Error(`Auth error: ${authError.message}`)
  if (!user) return
  if (!notes.length) return
  const res = await supabase.from('notes').upsert(
    notes.map((r) => ({ ...(toSnake(r) as PlainObject), user_id: user.id })),
    { onConflict: 'id' },
  )
  if (res.error) {
    console.error('[SYNC] pushNotesToSupabase error:', res.error)
    throw new Error(`notes: ${res.error.message} (code ${res.error.code})`)
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface SyncStatus {
  syncing: boolean
  lastSynced: Date | null
  error: string | null
  manualPush: () => Promise<void>
}

export function useSync(): SyncStatus {
  const [syncing, setSyncing] = useState(false)
  const [lastSynced, setLastSynced] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)

  const libraryDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const notesDebounceRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(false)
  const pushInFlightRef = useRef(false)
  // Shared across tabs via BroadcastChannel — notifies peers of completed pushes.
  const syncChannel = useRef<BroadcastChannel | null>(null)

  const handlePush = useCallback(async () => {
    if (pushInFlightRef.current) {
      console.log('[SYNC] handlePush: push already in-flight, skipping')
      return
    }
    pushInFlightRef.current = true
    setSyncing(true)
    setError(null)
    try {
      const doPush = async () => {
        // Re-read state inside the Web Lock — if we waited for another tab's
        // push to finish, realtime events + BroadcastChannel messages will have
        // already corrected our local state by the time we get here.
        const s = useLibraryStore.getState()
        console.log('[SYNC] handlePush: pushing', { decks: s.decks.map(d => ({ id: d.id, name: d.name })) })
        await pushToSupabase(s.folders, s.decks, s.cards, s.srsData, s.sessions, s.pendingDeletes)
        // Clear only the IDs that were in this push — new deletes queued
        // while in-flight are preserved for the next push.
        if (s.pendingDeletes.folders.length || s.pendingDeletes.decks.length || s.pendingDeletes.cards.length) {
          useLibraryStore.getState().clearPendingDeletes(s.pendingDeletes)
          // Immediately tell other tabs which items were deleted so they strip
          // them from their local state before their own push acquires the lock.
          syncChannel.current?.postMessage({
            type: 'push-complete',
            deletedFolders: s.pendingDeletes.folders,
            deletedDecks:   s.pendingDeletes.decks,
            deletedCards:   s.pendingDeletes.cards,
          })
        }
      }
      // navigator.locks serialises pushes across all tabs for the same origin.
      // The lock is automatically released when the tab closes, so there is no
      // risk of permanent starvation.
      if (typeof navigator !== 'undefined' && 'locks' in navigator) {
        await navigator.locks.request('nemos-sync-push', doPush)
      } else {
        await doPush()
      }
      console.log('[SYNC] handlePush: push COMPLETE')
      setLastSynced(new Date())
    } catch (err) {
      console.error('[SYNC] handlePush: push ERROR', err)
      setError(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      pushInFlightRef.current = false
      setSyncing(false)
    }
  }, [])

  const handleNotesPush = useCallback(async (notes: Note[]) => {
    setSyncing(true)
    setError(null)
    try {
      await pushNotesToSupabase(notes)
      setLastSynced(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }, [])

  // BroadcastChannel — receive deletion events from other tabs and strip those
  // items from local state immediately, before this tab's next push acquires
  // the Web Lock. This prevents a tab with stale state from re-upserting items
  // that another tab just deleted.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const bc = new BroadcastChannel('nemos-sync')
    syncChannel.current = bc
    bc.onmessage = (e: MessageEvent) => {
      if (e.data?.type !== 'push-complete') return
      const deletedFolders: string[] = e.data.deletedFolders ?? []
      const deletedDecks: string[]   = e.data.deletedDecks   ?? []
      const deletedCards: string[]   = e.data.deletedCards   ?? []
      if (!deletedFolders.length && !deletedDecks.length && !deletedCards.length) return
      console.log('[SYNC] BroadcastChannel: another tab deleted items, applying locally', { deletedFolders, deletedDecks, deletedCards })
      const fSet = new Set(deletedFolders)
      const dSet = new Set(deletedDecks)
      const cSet = new Set(deletedCards)
      useLibraryStore.setState((s) => ({
        folders: s.folders.filter((f) => !fSet.has(f.id)),
        decks:   s.decks.filter((d)   => !dSet.has(d.id)),
        cards:   s.cards.filter((c)   => !cSet.has(c.id)),
        srsData: Object.fromEntries(Object.entries(s.srsData).filter(([id]) => !cSet.has(id))),
        pendingDeletes: {
          folders: s.pendingDeletes.folders.filter((id) => !fSet.has(id)),
          decks:   s.pendingDeletes.decks.filter((id)   => !dSet.has(id)),
          cards:   s.pendingDeletes.cards.filter((id)   => !cSet.has(id)),
        },
      }))
    }
    return () => {
      bc.close()
      syncChannel.current = null
    }
  }, [])

  // Initial pull on mount
  useEffect(() => {
    let cancelled = false

    // Rehydrate from localStorage first so the UI has instant data.
    // Pull from Supabase then merges on top (server wins for conflicts,
    // local-only items are preserved in case push hasn't completed yet).
    const init = async () => {
      await useLibraryStore.persist.rehydrate()
      await useNotesStore.persist.rehydrate()
      // Rewrite legacy non-UUID ids (pre-crypto.randomUUID data) so pushes
      // don't fail Supabase's uuid columns. No-op when nothing is legacy.
      migrateLegacyIds()
      console.log('[SYNC] useSync mount: starting initial pull')
      await pullFromSupabase()
    }

    setSyncing(true)
    init()
      .then(() => {
        if (!cancelled) {
          console.log('[SYNC] useSync mount: initial pull done, mountedRef → true')
          setLastSynced(new Date())
          mountedRef.current = true
          // Push any local changes that existed before pull completed (e.g. cards created during load)
          const state = useLibraryStore.getState()
          if (state.folders.length || state.decks.length || state.cards.length || state.pendingDeletes.folders.length || state.pendingDeletes.decks.length || state.pendingDeletes.cards.length) {
            handlePush()
          }
        } else {
          console.log('[SYNC] useSync mount: initial pull done but component was cancelled/unmounted')
        }
      })
      .catch((err: unknown) => {
        console.error('[SYNC] useSync mount: initial pull FAILED', err)
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Initial sync failed')
        }
      })
      .finally(() => {
        if (!cancelled) setSyncing(false)
      })
    return () => {
      console.log('[SYNC] useSync UNMOUNT — cancelled = true')
      cancelled = true
    }
  }, [])

  // Subscribe to library store changes with 1.5s debounce
  useEffect(() => {
    const unsub = useLibraryStore.subscribe(() => {
      if (!mountedRef.current) {
        console.log('[SYNC] store change ignored — mountedRef is false (pull not yet complete)')
        return
      }
      if (libraryDebounceRef.current) clearTimeout(libraryDebounceRef.current)
      libraryDebounceRef.current = setTimeout(() => {
        handlePush()
      }, 400)
    })
    return () => {
      unsub()
      if (libraryDebounceRef.current) clearTimeout(libraryDebounceRef.current)
    }
  }, [handlePush])

  // Subscribe to notes store changes with 1.5s debounce
  useEffect(() => {
    const unsub = useNotesStore.subscribe((state) => {
      if (!mountedRef.current) return
      if (notesDebounceRef.current) clearTimeout(notesDebounceRef.current)
      notesDebounceRef.current = setTimeout(() => {
        handleNotesPush(state.notes)
      }, 400)
    })
    return () => {
      unsub()
      if (notesDebounceRef.current) clearTimeout(notesDebounceRef.current)
    }
  }, [handleNotesPush])

  // Supabase Realtime subscriptions — merge individual rows instead of full pull
  useEffect(() => {
    if (!isSupabaseConfigured()) return
    const supabase = createClient()

    const channel = supabase.channel(`nemos-realtime-${Math.random().toString(36).slice(2)}`)

    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'folders' },
      (payload) => {
        const { eventType, new: newRow, old: oldRow } = payload
        if (eventType === 'INSERT' || eventType === 'UPDATE') {
          const folder = toCamel(newRow) as Folder
          if (eventType === 'INSERT') realtimePending.folders.add(folder.id)
          useLibraryStore.setState((state) => {
            // Don't resurrect items that are pending local deletion
            if (state.pendingDeletes.folders.includes(folder.id)) return {}
            const exists = state.folders.some((f) => f.id === folder.id)
            return {
              folders: exists
                ? state.folders.map((f) => f.id === folder.id ? folder : f)
                : [...state.folders, folder],
            }
          })
        } else if (eventType === 'DELETE') {
          const id = (oldRow as { id: string }).id
          useLibraryStore.setState((state) => ({
            folders: state.folders.filter((f) => f.id !== id),
          }))
        }
      },
    )

    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'decks' },
      (payload) => {
        const { eventType, new: newRow, old: oldRow } = payload
        if (eventType === 'INSERT' || eventType === 'UPDATE') {
          const deck = toCamel(newRow) as Deck
          if (eventType === 'INSERT') realtimePending.decks.add(deck.id)
          useLibraryStore.setState((state) => {
            if (state.pendingDeletes.decks.includes(deck.id)) return {}
            const exists = state.decks.some((d) => d.id === deck.id)
            return {
              decks: exists
                ? state.decks.map((d) => d.id === deck.id ? deck : d)
                : [...state.decks, deck],
            }
          })
        } else if (eventType === 'DELETE') {
          const id = (oldRow as { id: string }).id
          useLibraryStore.setState((state) => ({
            decks: state.decks.filter((d) => d.id !== id),
          }))
        }
      },
    )

    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'cards' },
      (payload) => {
        const { eventType, new: newRow, old: oldRow } = payload
        if (eventType === 'INSERT' || eventType === 'UPDATE') {
          const card = toCamel(newRow) as Card
          if (eventType === 'INSERT') realtimePending.cards.add(card.id)
          useLibraryStore.setState((state) => {
            if (state.pendingDeletes.cards.includes(card.id)) return {}
            const exists = state.cards.some((c) => c.id === card.id)
            return {
              cards: exists
                ? state.cards.map((c) => c.id === card.id ? card : c)
                : [...state.cards, card],
            }
          })
        } else if (eventType === 'DELETE') {
          const id = (oldRow as { id: string }).id
          useLibraryStore.setState((state) => ({
            cards: state.cards.filter((c) => c.id !== id),
          }))
        }
      },
    )

    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'review_logs' },
      (payload) => {
        const { eventType, new: newRow, old: oldRow } = payload
        if (eventType === 'INSERT' || eventType === 'UPDATE') {
          const log = toCamel(newRow) as ReviewLog
          if (eventType === 'INSERT') realtimePending.reviewLogs.add(log.id)
          useLibraryStore.setState((state) => {
            const exists = state.reviewLogs.some((l) => l.id === log.id)
            return {
              reviewLogs: exists
                ? state.reviewLogs.map((l) => l.id === log.id ? log : l)
                : [...state.reviewLogs, log],
            }
          })
        } else if (eventType === 'DELETE') {
          const id = (oldRow as { id: string }).id
          useLibraryStore.setState((state) => ({
            reviewLogs: state.reviewLogs.filter((l) => l.id !== id),
          }))
        }
      },
    )

    const channelName = channel.topic
    console.log('[SYNC] realtime channel subscribing:', channelName)
    channel.subscribe((status) => {
      console.log('[SYNC] realtime channel status:', channelName, status)
    })

    return () => {
      console.log('[SYNC] realtime channel unsubscribing:', channelName)
      supabase.removeChannel(channel)
    }
  }, [])

  const manualPush = useCallback(async () => {
    await handlePush()
  }, [handlePush])

  return { syncing, lastSynced, error, manualPush }
}
