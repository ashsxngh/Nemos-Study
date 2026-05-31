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

  useLibraryStore.setState({ folders, decks, cards, srsData, sessions, reviewLogs })
  useNotesStore.setState({ notes })
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

  await Promise.all([
    folders.length
      ? supabase.from('folders').upsert(folders.map((r) => toSnake(r)), upsertOpts)
      : null,
    decks.length
      ? supabase.from('decks').upsert(decks.map((r) => toSnake(r)), upsertOpts)
      : null,
    cards.length
      ? supabase.from('cards').upsert(cards.map((r) => toSnake(r)), upsertOpts)
      : null,
    Object.keys(srsData).length
      ? supabase.from('srs_data').upsert(
          Object.values(srsData).map((r) => toSnake(r)),
          { onConflict: 'card_id' },
        )
      : null,
    sessions.length
      ? supabase.from('review_sessions').upsert(sessions.map((r) => toSnake(r)), upsertOpts)
      : null,
  ])
}

async function pushNotesToSupabase(notes: Note[]): Promise<void> {
  if (!isSupabaseConfigured()) return
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  if (!notes.length) return
  await supabase.from('notes').upsert(notes.map((r) => toSnake(r)), { onConflict: 'id' })
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

  // Supabase Realtime subscriptions
  useEffect(() => {
    if (!isSupabaseConfigured()) return
    const supabase = createClient()

    const channel = supabase.channel(`nemos-realtime-${Math.random().toString(36).slice(2)}`)

    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'cards' },
      () => { pullFromSupabase().catch(() => null) },
    )
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'decks' },
      () => { pullFromSupabase().catch(() => null) },
    )
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'folders' },
      () => { pullFromSupabase().catch(() => null) },
    )
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'review_logs' },
      () => { pullFromSupabase().catch(() => null) },
    )

    channel.subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  return { syncing, lastSynced, error }
}
