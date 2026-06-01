'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client'
import { useLibraryStore } from '@/store/useLibraryStore'
import { useNotesStore } from '@/store/useNotesStore'
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

// ─── Realtime-pending tracker ─────────────────────────────────────────────────
// Realtime INSERT handlers register row IDs here before updating Zustand state.
// pullFromSupabase() reads this set when it resolves to decide which rows in the
// current store were written by a realtime event (and must be preserved) versus
// which rows came from a stale localStorage snapshot (and must be dropped if the
// server no longer has them).

const realtimePending = {
  folders:    new Set<string>(),
  decks:      new Set<string>(),
  cards:      new Set<string>(),
  reviewLogs: new Set<string>(),
  notes:      new Set<string>(),
}

// Server rows are authoritative for matching IDs. Current rows whose IDs are
// absent from the server response are kept only when they arrived via realtime
// (i.e. their ID is in pendingIds). Stale localStorage rows that were deleted on
// the server are dropped — their IDs are absent from both serverRows and
// pendingIds.
function mergeWithPending<T extends { id: string }>(
  serverRows: T[],
  currentRows: T[],
  pendingIds: Set<string>,
): T[] {
  const serverMap = new Map(serverRows.map((r) => [r.id, r]))
  const realtimeOnly = currentRows.filter(
    (r) => !serverMap.has(r.id) && pendingIds.has(r.id),
  )
  return [...serverRows, ...realtimeOnly]
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

  const folders = (foldersRes.data ?? []).map((r) => toCamel(r) as Folder)
  const decks   = (decksRes.data   ?? []).map((r) => toCamel(r) as Deck)
  const cards   = (cardsRes.data   ?? []).map((r) => toCamel(r) as Card)
  const sessions = (sessionsRes.data ?? []).map((r) => toCamel(r) as ReviewSession)
  const reviewLogs = (logsRes.data  ?? []).map((r) => toCamel(r) as ReviewLog)
  const notes   = (notesRes.data   ?? []).map((r) => toCamel(r) as Note)

  // srsData is stored as a Record<cardId, SRSData> in the store
  const srsData: Record<string, SRSData> = {}
  for (const row of srsRes.data ?? []) {
    const s = toCamel(row) as SRSData
    srsData[s.cardId] = s
  }

  // Functional updater so we can merge rather than replace. Server rows win for
  // matching IDs; rows that arrived via realtime while the queries were in-flight
  // are preserved via realtimePending; stale localStorage-only rows are dropped.
  useLibraryStore.setState((current) => ({
    folders:    mergeWithPending(folders,    current.folders,    realtimePending.folders),
    decks:      mergeWithPending(decks,      current.decks,      realtimePending.decks),
    cards:      mergeWithPending(cards,      current.cards,      realtimePending.cards),
    srsData:    { ...current.srsData, ...srsData },
    sessions,
    reviewLogs: mergeWithPending(reviewLogs, current.reviewLogs, realtimePending.reviewLogs),
  }))
  useNotesStore.setState((current) => ({
    notes: mergeWithPending(notes, current.notes, realtimePending.notes),
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
): Promise<void> {
  if (!isSupabaseConfigured()) return
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const upsertOpts = { onConflict: 'id' } as const

  const withUserId = (r: unknown) => ({ ...(toSnake(r) as PlainObject), user_id: user.id })

  await Promise.all([
    folders.length
      ? supabase.from('folders').upsert(folders.map(withUserId), upsertOpts)
      : null,
    decks.length
      ? supabase.from('decks').upsert(decks.map(withUserId), upsertOpts)
      : null,
    cards.length
      ? supabase.from('cards').upsert(cards.map(withUserId), upsertOpts)
      : null,
    Object.keys(srsData).length
      ? supabase.from('srs_data').upsert(
          Object.values(srsData).map(withUserId),
          { onConflict: 'card_id' },
        )
      : null,
    sessions.length
      ? supabase.from('review_sessions').upsert(sessions.map(withUserId), upsertOpts)
      : null,
  ])
}

async function pushNotesToSupabase(notes: Note[]): Promise<void> {
  if (!isSupabaseConfigured()) return
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  if (!notes.length) return
  await supabase.from('notes').upsert(
    notes.map((r) => ({ ...(toSnake(r) as PlainObject), user_id: user.id })),
    { onConflict: 'id' },
  )
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface SyncStatus {
  syncing: boolean
  lastSynced: Date | null
  error: string | null
}

export function useSync(): SyncStatus {
  const [syncing, setSyncing] = useState(false)
  const [lastSynced, setLastSynced] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)

  const libraryDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const notesDebounceRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(false)

  const handlePush = useCallback(async (
    folders: Folder[],
    decks: Deck[],
    cards: Card[],
    srsData: Record<string, SRSData>,
    sessions: ReviewSession[],
  ) => {
    setSyncing(true)
    setError(null)
    try {
      await pushToSupabase(folders, decks, cards, srsData, sessions)
      setLastSynced(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed')
    } finally {
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

  // Initial pull on mount
  useEffect(() => {
    let cancelled = false

    // Rehydrate localStorage synchronously first so the UI has instant data
    // from the previous session. This must happen before pullFromSupabase() so
    // the async Supabase response (and any realtime events that arrive while it
    // is in-flight) always lands on top of the localStorage snapshot — never
    // the other way around.
    useLibraryStore.persist.rehydrate()
    useNotesStore.persist.rehydrate()

    setSyncing(true)
    pullFromSupabase()
      .then(() => {
        if (!cancelled) {
          setLastSynced(new Date())
          mountedRef.current = true
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Initial sync failed')
        }
      })
      .finally(() => {
        if (!cancelled) setSyncing(false)
      })
    return () => { cancelled = true }
  }, [])

  // Subscribe to library store changes with 1.5s debounce
  useEffect(() => {
    const unsub = useLibraryStore.subscribe((state) => {
      if (!mountedRef.current) return
      if (libraryDebounceRef.current) clearTimeout(libraryDebounceRef.current)
      libraryDebounceRef.current = setTimeout(() => {
        handlePush(state.folders, state.decks, state.cards, state.srsData, state.sessions)
      }, 1500)
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
      }, 1500)
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

    channel.subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  return { syncing, lastSynced, error }
}
