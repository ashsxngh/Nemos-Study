'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client'
import { useLibraryStore } from '@/store/useLibraryStore'
import { useNotesStore } from '@/store/useNotesStore'
import { useExamStore } from '@/store/useExamStore'
import { useSettingsStore } from '@/store/useSettingsStore'
import { migrateLegacyIds } from '@/lib/migrateLegacyIds'
import type {
  Folder,
  Deck,
  Card,
  SRSData,
  ReviewSession,
  ReviewLog,
  Note,
  Exam,
} from '@/lib/types'
import type { FSRSState } from '@/lib/srs'

const DEBUG_SYNC = false

// PostgrestError instances often print as "{}" through console.error once they
// cross a dev-server/HMR serialization boundary (their fields aren't plain
// own-enumerable props in every bundler). Pull out the fields explicitly so
// the actual message/code always shows up in the console.
function formatPgError(error: { message?: string; code?: string; details?: string; hint?: string }): string {
  return [error.message, error.code && `(code ${error.code})`, error.details, error.hint]
    .filter(Boolean)
    .join(' ') || JSON.stringify(error)
}

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

// IDs that existed in localStorage when this session loaded (snapshotted once,
// before the first pull). An item that is local-only AND in this set was deleted
// on another device — drop it. An item that is local-only but NOT in this set
// was created during this session (before push completed) — keep it.
const preExistingIds = {
  folders:    new Set<string>(),
  decks:      new Set<string>(),
  cards:      new Set<string>(),
  notes:      new Set<string>(),
  reviewLogs: new Set<string>(),
  exams:      new Set<string>(),
}
let preExistingSnapshotTaken = false

function snapshotPreExistingIds(): void {
  if (preExistingSnapshotTaken) return
  const s  = useLibraryStore.getState()
  const ns = useNotesStore.getState()
  const es = useExamStore.getState()
  s.folders.forEach((f) => preExistingIds.folders.add(f.id))
  s.decks.forEach((d)   => preExistingIds.decks.add(d.id))
  s.cards.forEach((c)   => preExistingIds.cards.add(c.id))
  s.reviewLogs.forEach((l) => preExistingIds.reviewLogs.add(l.id))
  ns.notes.forEach((n)  => preExistingIds.notes.add(n.id))
  es.exams.forEach((e)  => preExistingIds.exams.add(e.id))
  preExistingSnapshotTaken = true
}

// Merge server rows with local state.
// - Server always wins for items that exist on both sides.
// - Local-only items present in preExistingSet were loaded from a previous session
//   and are absent from the server = they were deleted on another device. Drop them.
// - Local-only items NOT in preExistingSet were created this session before push
//   completed. Keep them so they get pushed.
// - When preExistingSet is omitted (review logs), all local-only rows are kept
//   because review logs are append-only and never deleted by users.
function mergeKeepLocal<T extends { id: string }>(
  serverRows: T[],
  currentRows: T[],
  preExistingSet?: Set<string>,
): T[] {
  const serverMap = new Map(serverRows.map((r) => [r.id, r]))
  const localOnly = currentRows.filter((r) => {
    if (serverMap.has(r.id)) return false
    if (preExistingSet?.has(r.id)) return false
    return true
  })
  if (localOnly.length > 0 && DEBUG_SYNC) {
    console.log(`[SYNC] mergeKeepLocal: preserving ${localOnly.length} session-created local-only item(s)`, localOnly.map((r) => r.id))
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
    fsrsRes,
    sessionsRes,
    logsRes,
    notesRes,
    examsRes,
    settingsRes,
  ] = await Promise.all([
    supabase.from('folders').select('*').eq('user_id', user.id),
    supabase.from('decks').select('*').eq('user_id', user.id),
    supabase.from('cards').select('*').eq('user_id', user.id),
    supabase.from('srs_data').select('*').eq('user_id', user.id),
    supabase.from('fsrs_data').select('*').eq('user_id', user.id),
    supabase.from('review_sessions').select('*').eq('user_id', user.id),
    supabase.from('review_logs').select('*').eq('user_id', user.id),
    supabase.from('notes').select('*').eq('user_id', user.id),
    supabase.from('exams').select('*').eq('user_id', user.id),
    supabase.from('user_settings').select('*').eq('user_id', user.id).maybeSingle(),
  ])

  // On error, log clearly and skip that table — local state is left untouched.
  if (foldersRes.error)  console.error('[SYNC] pullFromSupabase: folders error', formatPgError(foldersRes.error))
  if (decksRes.error)    console.error('[SYNC] pullFromSupabase: decks error', formatPgError(decksRes.error))
  if (cardsRes.error)    console.error('[SYNC] pullFromSupabase: cards error', formatPgError(cardsRes.error))
  if (srsRes.error)      console.error('[SYNC] pullFromSupabase: srs_data error', formatPgError(srsRes.error))
  if (fsrsRes.error)     console.error('[SYNC] pullFromSupabase: fsrs_data error', formatPgError(fsrsRes.error))
  if (sessionsRes.error) console.error('[SYNC] pullFromSupabase: review_sessions error', formatPgError(sessionsRes.error))
  if (logsRes.error)     console.error('[SYNC] pullFromSupabase: review_logs error', formatPgError(logsRes.error))
  if (notesRes.error)    console.error('[SYNC] pullFromSupabase: notes error', formatPgError(notesRes.error))
  if (examsRes.error)    console.error('[SYNC] pullFromSupabase: exams error', formatPgError(examsRes.error))
  if (settingsRes.error) console.error('[SYNC] pullFromSupabase: user_settings error', formatPgError(settingsRes.error))

  // Filter out anything locally queued for deletion so a pull never resurrects
  // an item the user deleted before the push debounce fired.
  const { pendingDeletes } = useLibraryStore.getState()
  const { pendingDeletedNotes } = useNotesStore.getState()
  const { pendingDeletedExams } = useExamStore.getState()
  const pendingFolderSet = new Set(pendingDeletes.folders)
  const pendingDeckSet   = new Set(pendingDeletes.decks)
  const pendingCardSet   = new Set(pendingDeletes.cards)
  const pendingNoteSet   = new Set(pendingDeletedNotes)
  const pendingExamSet   = new Set(pendingDeletedExams)

  // null = fetch errored → skip that table in setState (preserve local state).
  const folders = foldersRes.error ? null :
    (foldersRes.data ?? []).map((r) => toCamel(r) as Folder).filter((f) => !pendingFolderSet.has(f.id))
  const decks = decksRes.error ? null :
    (decksRes.data ?? []).map((r) => toCamel(r) as Deck).filter((d) => !pendingDeckSet.has(d.id))
  const cards = cardsRes.error ? null :
    (cardsRes.data ?? []).map((r) => toCamel(r) as Card).filter((c) => !pendingCardSet.has(c.id))
  const sessions = sessionsRes.error ? null :
    (sessionsRes.data ?? []).map((r) => toCamel(r) as ReviewSession)
  const reviewLogs = logsRes.error ? null :
    (logsRes.data ?? []).map((r) => toCamel(r) as ReviewLog)
  const notes = notesRes.error ? null :
    (notesRes.data ?? []).map((r) => toCamel(r) as Note).filter((n) => !pendingNoteSet.has(n.id))
  const exams = examsRes.error ? null :
    (examsRes.data ?? []).map((r) => toCamel(r) as Exam).filter((e) => !pendingExamSet.has(e.id))

  // Build srsData record from server rows. null on error — preserve local.
  // Pre-filter to fetched card IDs to avoid re-upserting orphaned rows; the
  // setState merge below does a final pass using the full merged card set.
  let fetchedSrsData: Record<string, SRSData> | null = null
  if (!srsRes.error) {
    fetchedSrsData = {}
    const fetchedCardSet = new Set((cards ?? []).map((c) => c.id))
    for (const row of srsRes.data ?? []) {
      const s = toCamel(row) as SRSData
      if (!pendingCardSet.has(s.cardId) && (cards === null || fetchedCardSet.has(s.cardId))) {
        fetchedSrsData[s.cardId] = s
      }
    }
  }

  // Same as fetchedSrsData but for FSRS scheduling state.
  let fetchedFsrsData: Record<string, FSRSState> | null = null
  if (!fsrsRes.error) {
    fetchedFsrsData = {}
    const fetchedCardSet = new Set((cards ?? []).map((c) => c.id))
    for (const row of fsrsRes.data ?? []) {
      const f = toCamel(row) as FSRSState
      if (!pendingCardSet.has(f.cardId) && (cards === null || fetchedCardSet.has(f.cardId))) {
        fetchedFsrsData[f.cardId] = f
      }
    }
  }

  useLibraryStore.setState((current) => {
    const mergedDecks = decks !== null
      ? mergeKeepLocal(decks, current.decks, preExistingIds.decks)
      : current.decks
    const mergedDeckSet = new Set(mergedDecks.map((d) => d.id))

    // Remove cards whose deck no longer exists (orphans from deleted decks).
    const rawMergedCards = cards !== null
      ? mergeKeepLocal(cards, current.cards, preExistingIds.cards)
      : current.cards
    const orphanCardIds = rawMergedCards
      .filter((c) => !mergedDeckSet.has(c.deckId))
      .map((c) => c.id)
    const mergedCards = orphanCardIds.length > 0
      ? rawMergedCards.filter((c) => mergedDeckSet.has(c.deckId))
      : rawMergedCards
    if (orphanCardIds.length > 0 && DEBUG_SYNC) {
      console.log(
        '[SYNC] pullFromSupabase: removing', orphanCardIds.length,
        'orphan card(s) with no matching deck, queuing for remote delete',
      )
    }

    const mergedCardSet = new Set(mergedCards.map((c) => c.id))
    const newOrphanIds = orphanCardIds.filter(
      (id) => !current.pendingDeletes.cards.includes(id),
    )

    // Merge srsData: server wins for existing entries, prune orphans.
    const mergedSrsData = fetchedSrsData !== null
      ? Object.fromEntries(
          Object.entries({ ...current.srsData, ...fetchedSrsData }).filter(([id]) => mergedCardSet.has(id))
        )
      : Object.fromEntries(Object.entries(current.srsData).filter(([id]) => mergedCardSet.has(id)))

    // Merge fsrsData the same way — server wins for existing entries, prune orphans.
    const mergedFsrsData = fetchedFsrsData !== null
      ? Object.fromEntries(
          Object.entries({ ...current.fsrsData, ...fetchedFsrsData }).filter(([id]) => mergedCardSet.has(id))
        )
      : Object.fromEntries(Object.entries(current.fsrsData).filter(([id]) => mergedCardSet.has(id)))

    return {
      ...(folders !== null ? { folders: mergeKeepLocal(folders, current.folders, preExistingIds.folders) } : {}),
      decks: mergedDecks,
      cards: mergedCards,
      srsData: mergedSrsData,
      fsrsData: mergedFsrsData,
      ...(sessions !== null ? { sessions } : {}),
      ...(reviewLogs !== null ? { reviewLogs: mergeKeepLocal(reviewLogs, current.reviewLogs) } : {}),
      ...(newOrphanIds.length > 0 ? {
        pendingDeletes: {
          ...current.pendingDeletes,
          cards: [...current.pendingDeletes.cards, ...newOrphanIds],
        },
      } : {}),
    }
  })

  if (notes !== null) {
    useNotesStore.setState((current) => ({
      notes: mergeKeepLocal(notes, current.notes, preExistingIds.notes),
    }))
  }

  if (exams !== null) {
    useExamStore.setState((current) => ({
      exams: mergeKeepLocal(exams, current.exams, preExistingIds.exams),
    }))
  }

  // user_settings is a single row, not a list — server always wins outright
  // when a row exists. No row yet (new user) means nothing to hydrate.
  if (!settingsRes.error && settingsRes.data) {
    const s = toCamel(settingsRes.data) as { newCardsPerDay: number }
    useSettingsStore.setState({ newCardsPerDay: s.newCardsPerDay })
  }

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
  fsrsData: Record<string, FSRSState>,
  sessions: ReviewSession[],
  reviewLogs: ReviewLog[],
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

  if (DEBUG_SYNC) {
    console.log('[SYNC] pushToSupabase: upserting to Supabase as user', user.id, {
      folders: folders.length,
      decks: decks.length,
      cards: cards.length,
      srsData: Object.keys(srsData).length,
      fsrsData: Object.keys(fsrsData).length,
      sessions: sessions.length,
      reviewLogs: reviewLogs.length,
    })
  }

  // Only upsert srs_data/fsrs_data for cards that exist in the active card set.
  // This prevents orphaned entries (e.g. from a deleted deck whose cards were
  // briefly re-pulled from Supabase before the delete push ran) from being
  // written back. Also excludes cards about to be deleted to avoid a deadlock
  // (upsert + delete on the same row in the same push → PostgreSQL 40P01).
  const activeCardSet  = new Set(cards.map((c) => c.id))
  const cardDeleteSet  = new Set(pendingDeletes?.cards ?? [])
  const srsToUpsert = Object.values(srsData).filter(
    (s) => activeCardSet.has(s.cardId) && !cardDeleteSet.has(s.cardId)
  )
  const fsrsToUpsert = Object.values(fsrsData).filter(
    (f) => activeCardSet.has(f.cardId) && !cardDeleteSet.has(f.cardId)
  )

  // Upsert in batches — large payloads can exceed PostgREST body/row limits.
  async function upsertBatched<T>(
    table: 'folders' | 'decks' | 'cards' | 'srs_data' | 'fsrs_data' | 'review_sessions' | 'review_logs',
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
    fsrsToUpsert.length
      ? upsertBatched('fsrs_data', fsrsToUpsert.map(withUserId), { onConflict: 'card_id' })
      : null,
    sessions.length
      ? upsertBatched('review_sessions', sessions.map(withUserId), upsertOpts)
      : null,
    reviewLogs.length
      ? upsertBatched('review_logs', reviewLogs.map(withUserId), upsertOpts)
      : null,
  ])

  if (DEBUG_SYNC) console.log('[SYNC] pushToSupabase: all upserts succeeded')

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
          console.error('[SYNC] pushToSupabase: cards delete error', formatPgError(delCards.error))
          throw new Error(`cards delete: ${delCards.error.message} (code ${delCards.error.code})`)
        }
        const delSrs = await supabase.from('srs_data').delete().in('card_id', chunk)
        if (delSrs.error) {
          console.error('[SYNC] pushToSupabase: srs_data delete error', formatPgError(delSrs.error))
          throw new Error(`srs_data delete: ${delSrs.error.message} (code ${delSrs.error.code})`)
        }
      }
    }
    if (pendingDeletes.decks.length) {
      for (let i = 0; i < pendingDeletes.decks.length; i += BATCH) {
        const chunk = pendingDeletes.decks.slice(i, i + BATCH)
        const delDecks = await supabase.from('decks').delete().in('id', chunk)
        if (delDecks.error) {
          console.error('[SYNC] pushToSupabase: decks delete error', formatPgError(delDecks.error))
          throw new Error(`decks delete: ${delDecks.error.message} (code ${delDecks.error.code})`)
        }
      }
    }
    if (pendingDeletes.folders.length) {
      for (let i = 0; i < pendingDeletes.folders.length; i += BATCH) {
        const chunk = pendingDeletes.folders.slice(i, i + BATCH)
        const delFolders = await supabase.from('folders').delete().in('id', chunk)
        if (delFolders.error) {
          console.error('[SYNC] pushToSupabase: folders delete error', formatPgError(delFolders.error))
          throw new Error(`folders delete: ${delFolders.error.message} (code ${delFolders.error.code})`)
        }
      }
    }
    if (pendingDeletes.folders.length || pendingDeletes.decks.length || pendingDeletes.cards.length) {
      if (DEBUG_SYNC) console.log('[SYNC] pushToSupabase: deletes complete')
    }
  }
}

async function pushNotesToSupabase(notes: Note[], pendingDeletedNotes: string[]): Promise<void> {
  if (!isSupabaseConfigured()) return
  const supabase = createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError) throw new Error(`Auth error: ${authError.message}`)
  if (!user) return

  const BATCH = 100

  if (pendingDeletedNotes.length) {
    for (let i = 0; i < pendingDeletedNotes.length; i += BATCH) {
      const chunk = pendingDeletedNotes.slice(i, i + BATCH)
      const res = await supabase.from('notes').delete().in('id', chunk)
      if (res.error) {
        console.error('[SYNC] pushNotesToSupabase: delete error', formatPgError(res.error))
        throw new Error(`notes delete: ${res.error.message} (code ${res.error.code})`)
      }
    }
  }

  if (!notes.length) return
  const res = await supabase.from('notes').upsert(
    notes.map((r) => ({ ...(toSnake(r) as PlainObject), user_id: user.id })),
    { onConflict: 'id' },
  )
  if (res.error) {
    console.error('[SYNC] pushNotesToSupabase error:', formatPgError(res.error))
    throw new Error(`notes: ${res.error.message} (code ${res.error.code})`)
  }
}

async function pushExamsToSupabase(exams: Exam[], pendingDeletedExams: string[]): Promise<void> {
  if (!isSupabaseConfigured()) return
  const supabase = createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError) throw new Error(`Auth error: ${authError.message}`)
  if (!user) return

  const BATCH = 100

  if (pendingDeletedExams.length) {
    for (let i = 0; i < pendingDeletedExams.length; i += BATCH) {
      const chunk = pendingDeletedExams.slice(i, i + BATCH)
      const res = await supabase.from('exams').delete().in('id', chunk)
      if (res.error) {
        console.error('[SYNC] pushExamsToSupabase: delete error', formatPgError(res.error))
        throw new Error(`exams delete: ${res.error.message} (code ${res.error.code})`)
      }
    }
  }

  if (!exams.length) return
  const res = await supabase.from('exams').upsert(
    exams.map((e) => ({ ...(toSnake(e) as PlainObject), user_id: user.id })),
    { onConflict: 'id' },
  )
  if (res.error) {
    console.error('[SYNC] pushExamsToSupabase error:', formatPgError(res.error))
    throw new Error(`exams: ${res.error.message} (code ${res.error.code})`)
  }
}

async function pushSettingsToSupabase(newCardsPerDay: number): Promise<void> {
  if (!isSupabaseConfigured()) return
  const supabase = createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError) throw new Error(`Auth error: ${authError.message}`)
  if (!user) return

  const res = await supabase.from('user_settings').upsert(
    { user_id: user.id, new_cards_per_day: newCardsPerDay, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' },
  )
  if (res.error) {
    console.error('[SYNC] pushSettingsToSupabase error:', formatPgError(res.error))
    throw new Error(`user_settings: ${res.error.message} (code ${res.error.code})`)
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface SyncStatus {
  syncing: boolean
  lastSynced: Date | null
  error: string | null
  offline: boolean
  manualPush: () => Promise<void>
}

export function useSync(): SyncStatus {
  const [syncing, setSyncing] = useState(false)
  const [lastSynced, setLastSynced] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)

  const libraryDebounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const notesDebounceRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const examsDebounceRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const settingsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(false)
  const pushInFlightRef = useRef(false)
  // Shared across tabs via BroadcastChannel — notifies peers of completed pushes.
  const syncChannel = useRef<BroadcastChannel | null>(null)
  // Set synchronously around setState calls that apply a remote tab's change
  // locally, so the store subscribers below can tell "remote-applied" apart
  // from "local edit" and skip re-pushing — otherwise applying a broadcast
  // triggers this tab's own push, which re-broadcasts, which the other tab
  // re-applies and re-pushes, looping indefinitely between tabs.
  const applyingRemoteRef = useRef(false)

  const handlePush = useCallback(async () => {
    // Offline: skip the push attempt entirely rather than letting it fail and
    // surface as a sync error. The 'online' listener below retries automatically.
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      if (DEBUG_SYNC) console.log('[SYNC] handlePush: offline, skipping push')
      setOffline(true)
      setError(null)
      return
    }
    if (pushInFlightRef.current) {
      if (DEBUG_SYNC) console.log('[SYNC] handlePush: push already in-flight, skipping')
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
        if (DEBUG_SYNC) console.log('[SYNC] handlePush: pushing', { decks: s.decks.map(d => ({ id: d.id, name: d.name })) })
        await pushToSupabase(s.folders, s.decks, s.cards, s.srsData, s.fsrsData, s.sessions, s.reviewLogs, s.pendingDeletes)
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
      if (DEBUG_SYNC) console.log('[SYNC] handlePush: push COMPLETE')
      setOffline(false)
      setLastSynced(new Date())
    } catch (err) {
      console.error('[SYNC] handlePush: push ERROR', err)
      setError(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      pushInFlightRef.current = false
      setSyncing(false)
    }
  }, [])

  const handleNotesPush = useCallback(async (notes: Note[], pendingDeletedNotes: string[]) => {
    setSyncing(true)
    setError(null)
    try {
      await pushNotesToSupabase(notes, pendingDeletedNotes)
      if (pendingDeletedNotes.length) {
        useNotesStore.getState().clearPendingDeletedNotes(pendingDeletedNotes)
      }
      setLastSynced(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }, [])

  const handleExamsPush = useCallback(async (exams: Exam[], pendingDeletedExams: string[]) => {
    setSyncing(true)
    setError(null)
    try {
      await pushExamsToSupabase(exams, pendingDeletedExams)
      if (pendingDeletedExams.length) {
        useExamStore.getState().clearPendingDeletedExams(pendingDeletedExams)
      }
      // Tell other tabs about the new/updated/deleted exams immediately,
      // rather than waiting for their next pull cycle.
      syncChannel.current?.postMessage({
        type: 'exams-push-complete',
        exams,
        deletedExams: pendingDeletedExams,
      })
      setLastSynced(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }, [])

  const handleSettingsPush = useCallback(async (newCardsPerDay: number) => {
    setSyncing(true)
    setError(null)
    try {
      await pushSettingsToSupabase(newCardsPerDay)
      syncChannel.current?.postMessage({
        type: 'settings-push-complete',
        newCardsPerDay,
      })
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
      if (e.data?.type === 'exams-push-complete') {
        const pushedExams: Exam[] = e.data.exams ?? []
        const deletedExams: string[] = e.data.deletedExams ?? []
        if (!pushedExams.length && !deletedExams.length) return
        if (DEBUG_SYNC) console.log('[SYNC] BroadcastChannel: another tab pushed exam changes, applying locally', { pushedExams, deletedExams })
        const dSet = new Set(deletedExams)
        const examMap = new Map(pushedExams.map((ex) => [ex.id, ex]))
        applyingRemoteRef.current = true
        useExamStore.setState((s) => ({
          exams: [
            ...s.exams.filter((ex) => !dSet.has(ex.id) && !examMap.has(ex.id)),
            ...pushedExams,
          ],
          pendingDeletedExams: s.pendingDeletedExams.filter((id) => !dSet.has(id)),
        }))
        applyingRemoteRef.current = false
        return
      }
      if (e.data?.type === 'settings-push-complete') {
        if (DEBUG_SYNC) console.log('[SYNC] BroadcastChannel: another tab pushed settings changes, applying locally', e.data.newCardsPerDay)
        applyingRemoteRef.current = true
        useSettingsStore.setState({ newCardsPerDay: e.data.newCardsPerDay })
        applyingRemoteRef.current = false
        return
      }
      if (e.data?.type !== 'push-complete') return
      const deletedFolders: string[] = e.data.deletedFolders ?? []
      const deletedDecks: string[]   = e.data.deletedDecks   ?? []
      const deletedCards: string[]   = e.data.deletedCards   ?? []
      if (!deletedFolders.length && !deletedDecks.length && !deletedCards.length) return
      if (DEBUG_SYNC) console.log('[SYNC] BroadcastChannel: another tab deleted items, applying locally', { deletedFolders, deletedDecks, deletedCards })
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
    // Pull from Supabase then merges on top (server wins for conflicts;
    // only session-created local items are preserved — pre-existing ones
    // absent from the server were deleted elsewhere and are dropped).
    const init = async () => {
      await useLibraryStore.persist.rehydrate()
      await useNotesStore.persist.rehydrate()
      await useExamStore.persist.rehydrate()
      await useSettingsStore.persist.rehydrate()
      // Rewrite legacy non-UUID ids (pre-crypto.randomUUID data) so pushes
      // don't fail Supabase's uuid columns. No-op when nothing is legacy.
      migrateLegacyIds()
      // Snapshot which IDs currently exist in localStorage so that pull can
      // distinguish "deleted on another device" (pre-existing + absent from
      // server → drop) from "created this session" (not in snapshot → keep).
      snapshotPreExistingIds()
      if (DEBUG_SYNC) console.log('[SYNC] useSync mount: starting initial pull')
      await pullFromSupabase()
    }

    setSyncing(true)
    init()
      .then(() => {
        if (!cancelled) {
          if (DEBUG_SYNC) console.log('[SYNC] useSync mount: initial pull done, mountedRef → true')
          setLastSynced(new Date())
          mountedRef.current = true
          // Push any local changes that existed before pull completed (e.g. cards created during load)
          const state = useLibraryStore.getState()
          if (state.folders.length || state.decks.length || state.cards.length || state.pendingDeletes.folders.length || state.pendingDeletes.decks.length || state.pendingDeletes.cards.length) {
            handlePush()
          }
          // Seed exams/settings to Supabase even if nothing changes after
          // load — otherwise a row is only ever written on the *next* edit,
          // so pre-existing local exams and the user's current new-cards
          // limit would never reach the server (e.g. user_settings staying
          // empty forever for a user who never revisits Settings).
          const examState = useExamStore.getState()
          if (examState.exams.length || examState.pendingDeletedExams.length) {
            handleExamsPush(examState.exams, examState.pendingDeletedExams)
          }
          handleSettingsPush(useSettingsStore.getState().newCardsPerDay)
        } else if (DEBUG_SYNC) {
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
      if (DEBUG_SYNC) console.log('[SYNC] useSync UNMOUNT — cancelled = true')
      cancelled = true
    }
  }, [])

  // Retry automatically when connectivity is restored; track offline transitions.
  useEffect(() => {
    function handleOnline() {
      setOffline(false)
      if (DEBUG_SYNC) console.log('[SYNC] network online — retrying push')
      handlePush()
    }
    function handleOffline() {
      setOffline(true)
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [handlePush])

  // Subscribe to library store changes with a 400ms debounce
  useEffect(() => {
    const unsub = useLibraryStore.subscribe(() => {
      if (!mountedRef.current) {
        if (DEBUG_SYNC) console.log('[SYNC] store change ignored — mountedRef is false (pull not yet complete)')
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

  // Subscribe to notes store changes with a 400ms debounce
  useEffect(() => {
    const unsub = useNotesStore.subscribe((state) => {
      if (!mountedRef.current) return
      if (notesDebounceRef.current) clearTimeout(notesDebounceRef.current)
      notesDebounceRef.current = setTimeout(() => {
        handleNotesPush(state.notes, state.pendingDeletedNotes)
      }, 400)
    })
    return () => {
      unsub()
      if (notesDebounceRef.current) clearTimeout(notesDebounceRef.current)
    }
  }, [handleNotesPush])

  // Subscribe to exam store changes with a 400ms debounce
  useEffect(() => {
    const unsub = useExamStore.subscribe((state) => {
      if (!mountedRef.current || applyingRemoteRef.current) return
      if (examsDebounceRef.current) clearTimeout(examsDebounceRef.current)
      examsDebounceRef.current = setTimeout(() => {
        handleExamsPush(state.exams, state.pendingDeletedExams)
      }, 400)
    })
    return () => {
      unsub()
      if (examsDebounceRef.current) clearTimeout(examsDebounceRef.current)
    }
  }, [handleExamsPush])

  // Subscribe to settings store changes with a 400ms debounce — only the
  // daily new-card limit is synced; other settings fields stay local-only.
  useEffect(() => {
    const unsub = useSettingsStore.subscribe((state) => {
      if (!mountedRef.current || applyingRemoteRef.current) return
      if (settingsDebounceRef.current) clearTimeout(settingsDebounceRef.current)
      settingsDebounceRef.current = setTimeout(() => {
        handleSettingsPush(state.newCardsPerDay)
      }, 400)
    })
    return () => {
      unsub()
      if (settingsDebounceRef.current) clearTimeout(settingsDebounceRef.current)
    }
  }, [handleSettingsPush])

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
    if (DEBUG_SYNC) console.log('[SYNC] realtime channel subscribing:', channelName)
    channel.subscribe((status) => {
      if (DEBUG_SYNC) console.log('[SYNC] realtime channel status:', channelName, status)
    })

    return () => {
      if (DEBUG_SYNC) console.log('[SYNC] realtime channel unsubscribing:', channelName)
      supabase.removeChannel(channel)
    }
  }, [])

  const manualPush = useCallback(async () => {
    await handlePush()
  }, [handlePush])

  return { syncing, lastSynced, error, offline, manualPush }
}
