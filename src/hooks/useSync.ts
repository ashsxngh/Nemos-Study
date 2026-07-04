'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createClient, isSupabaseConfigured, getCachedUserId } from '@/lib/supabase/client'
import { useLibraryStore } from '@/store/useLibraryStore'
import { useHistoryStore } from '@/store/useHistoryStore'
import { useNotesStore } from '@/store/useNotesStore'
import { useExamStore } from '@/store/useExamStore'
import { useSettingsStore } from '@/store/useSettingsStore'
import { migrateLegacyIds } from '@/lib/migrateLegacyIds'
import type {
  Folder,
  Deck,
  Card,
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

// Structural equality, key-order insensitive — used to drop realtime echo
// events (our own writes broadcast back to us) without a setState call.
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((v, i) => deepEqual(v, b[i]))
  }
  const ka = Object.keys(a as PlainObject)
  const kb = Object.keys(b as PlainObject)
  if (ka.length !== kb.length) return false
  return ka.every((k) => deepEqual((a as PlainObject)[k], (b as PlainObject)[k]))
}

// One-time migration: reviewLogs/sessions used to live inside the persisted
// library store ('nemos-library'). They now have their own store — persist's
// default shallow merge keeps the old blob's stray keys on the rehydrated
// state, so lift them into the history store and blank them out of the
// library state (undefined values are dropped by JSON.stringify on the
// library store's next persist write). Runs after rehydrate, before the
// pre-existing-IDs snapshot and first pull.
function migrateHistoryToOwnStore(): void {
  const lib = useLibraryStore.getState() as unknown as Record<string, unknown>
  const strayLogs = Array.isArray(lib.reviewLogs) ? (lib.reviewLogs as ReviewLog[]) : []
  const straySessions = Array.isArray(lib.sessions) ? (lib.sessions as ReviewSession[]) : []
  if (!strayLogs.length && !straySessions.length) return
  const hist = useHistoryStore.getState()
  useHistoryStore.setState({
    // If the history store already has data (migration already ran), keep it —
    // the stray keys are then just leftovers to strip below.
    reviewLogs: hist.reviewLogs.length ? hist.reviewLogs : strayLogs,
    sessions: hist.sessions.length ? hist.sessions : straySessions,
  })
  useLibraryStore.setState({ reviewLogs: undefined, sessions: undefined } as unknown as Parameters<typeof useLibraryStore.setState>[0])
  if (DEBUG_SYNC) console.log(`[SYNC] migrateHistoryToOwnStore: moved ${strayLogs.length} log(s) / ${straySessions.length} session(s) into nemos-history`)
}

// One-time cleanup: the library store used to persist an SM-2 `srsData`
// record (removed along with the SM-2 algorithm). persist's default shallow
// merge keeps the old blob's stray key on the rehydrated state, where it
// would get re-serialized on every write — blank it out so the next persist
// write drops it (undefined values are stripped by JSON.stringify). The
// settings store similarly held SM-2-only keys (algorithm, easyBonus, …)
// that are now stray; they're tiny, but strip the algorithm flag too so no
// 'sm2' value can linger anywhere.
function stripLegacySm2State(): void {
  const lib = useLibraryStore.getState() as unknown as Record<string, unknown>
  if (lib.srsData !== undefined) {
    useLibraryStore.setState({ srsData: undefined } as unknown as Parameters<typeof useLibraryStore.setState>[0])
  }
  const settings = useSettingsStore.getState() as unknown as Record<string, unknown>
  if (settings.algorithm !== undefined) {
    useSettingsStore.setState({
      algorithm: undefined,
      easyBonus: undefined,
      hardInterval: undefined,
      graduatingInterval: undefined,
      lapseInterval: undefined,
      startingEase: undefined,
    } as unknown as Parameters<typeof useSettingsStore.setState>[0])
  }
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
  const hs = useHistoryStore.getState()
  const ns = useNotesStore.getState()
  const es = useExamStore.getState()
  s.folders.forEach((f) => preExistingIds.folders.add(f.id))
  s.decks.forEach((d)   => preExistingIds.decks.add(d.id))
  s.cards.forEach((c)   => preExistingIds.cards.add(c.id))
  hs.reviewLogs.forEach((l) => preExistingIds.reviewLogs.add(l.id))
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

// Merge server rows from an *incremental* pull (only rows changed since the
// last watermark) into local state. Unlike mergeKeepLocal, absence from
// serverRows never means "deleted elsewhere" here — it just means "unchanged
// since the watermark" — so nothing is ever dropped. Hard deletes are only
// detected by the once-per-session full pull (see preExistingIds).
function mergeIncremental<T extends { id: string }>(serverRows: T[], currentRows: T[]): T[] {
  if (serverRows.length === 0) return currentRows
  const serverMap = new Map(serverRows.map((r) => [r.id, r]))
  const updated = currentRows.map((r) => serverMap.get(r.id) ?? r)
  const currentIds = new Set(currentRows.map((r) => r.id))
  const added = serverRows.filter((r) => !currentIds.has(r.id))
  return [...updated, ...added]
}

// ─── Pull ─────────────────────────────────────────────────────────────────────

// The first pull of a browser session is always a full pull (needed to catch
// hard deletes — see mergeIncremental's docstring). Every subsequent pull in
// the same session only fetches rows changed since this watermark.
// sessionStorage (not localStorage) is deliberate: a new tab/session should
// always start with a full pull.
const LAST_FULL_PULL_KEY = 'nemos-last-pull-at'

function getLastPullAt(): string | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    return sessionStorage.getItem(LAST_FULL_PULL_KEY)
  } catch {
    return null
  }
}

function setLastPullAt(iso: string): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(LAST_FULL_PULL_KEY, iso)
  } catch {
    // sessionStorage unavailable (e.g. private browsing) — every pull in this
    // session will simply stay a full pull, which is correct, just unoptimized.
  }
}

async function pullFromSupabase(): Promise<void> {
  if (!isSupabaseConfigured()) return
  const supabase = createClient()
  const userId = await getCachedUserId(supabase)
  if (!userId) return

  const since = getLastPullAt()
  try {
    await runPull(supabase, userId, since)
  } catch (err) {
    if (since !== null) {
      console.error('[SYNC] pullFromSupabase: incremental pull failed, falling back to full pull', err)
      try {
        await runPull(supabase, userId, null)
      } catch (fallbackErr) {
        console.error('[SYNC] pullFromSupabase: full-pull fallback also failed', fallbackErr)
      }
    } else {
      console.error('[SYNC] pullFromSupabase: full pull failed', err)
    }
  }
}

async function runPull(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  since: string | null,
): Promise<void> {
  const incremental = since !== null
  const pullStartedAt = new Date().toISOString()

  const [
    foldersRes,
    decksRes,
    cardsRes,
    fsrsRes,
    sessionsRes,
    logsRes,
    notesRes,
    examsRes,
    settingsRes,
  ] = await Promise.all([
    since !== null
      ? supabase.from('folders').select('*').eq('user_id', userId).gt('updated_at', since)
      : supabase.from('folders').select('*').eq('user_id', userId),
    since !== null
      ? supabase.from('decks').select('*').eq('user_id', userId).gt('updated_at', since)
      : supabase.from('decks').select('*').eq('user_id', userId),
    since !== null
      ? supabase.from('cards').select('*').eq('user_id', userId).gt('updated_at', since)
      : supabase.from('cards').select('*').eq('user_id', userId),
    since !== null
      ? supabase.from('fsrs_data').select('*').eq('user_id', userId).gt('updated_at', since)
      : supabase.from('fsrs_data').select('*').eq('user_id', userId),
    // review_sessions has no updated_at and isn't part of the incremental-pull
    // scope — always fetched in full (it's cheap, append-mostly, low volume).
    supabase.from('review_sessions').select('*').eq('user_id', userId),
    since !== null
      ? supabase.from('review_logs').select('*').eq('user_id', userId).gt('reviewed_at', since)
      : supabase.from('review_logs').select('*').eq('user_id', userId),
    since !== null
      ? supabase.from('notes').select('*').eq('user_id', userId).gt('updated_at', since)
      : supabase.from('notes').select('*').eq('user_id', userId),
    since !== null
      ? supabase.from('exams').select('*').eq('user_id', userId).gt('updated_at', since)
      : supabase.from('exams').select('*').eq('user_id', userId),
    since !== null
      ? supabase.from('user_settings').select('*').eq('user_id', userId).gt('updated_at', since).maybeSingle()
      : supabase.from('user_settings').select('*').eq('user_id', userId).maybeSingle(),
  ])

  // On error, log clearly and skip that table — local state is left untouched.
  if (foldersRes.error)  console.error('[SYNC] pullFromSupabase: folders error', formatPgError(foldersRes.error))
  if (decksRes.error)    console.error('[SYNC] pullFromSupabase: decks error', formatPgError(decksRes.error))
  if (cardsRes.error)    console.error('[SYNC] pullFromSupabase: cards error', formatPgError(cardsRes.error))
  if (fsrsRes.error)     console.error('[SYNC] pullFromSupabase: fsrs_data error', formatPgError(fsrsRes.error))
  if (sessionsRes.error) console.error('[SYNC] pullFromSupabase: review_sessions error', formatPgError(sessionsRes.error))
  if (logsRes.error)     console.error('[SYNC] pullFromSupabase: review_logs error', formatPgError(logsRes.error))
  if (notesRes.error)    console.error('[SYNC] pullFromSupabase: notes error', formatPgError(notesRes.error))
  if (examsRes.error)    console.error('[SYNC] pullFromSupabase: exams error', formatPgError(examsRes.error))
  if (settingsRes.error) console.error('[SYNC] pullFromSupabase: user_settings error', formatPgError(settingsRes.error))

  // Tracked across both full and incremental pulls: an incremental pull that
  // errored on any table can't be trusted to have a complete picture (bail out
  // and let the caller retry as a full pull); a full pull that errored on any
  // table must not advance the watermark, or the rows missed during the error
  // window would never be fetched again until a new tab starts a fresh full pull.
  const anyError = !!(foldersRes.error || decksRes.error || cardsRes.error ||
    fsrsRes.error || sessionsRes.error || logsRes.error || notesRes.error || examsRes.error || settingsRes.error)
  if (incremental && anyError) {
    throw new Error('incremental pull: one or more tables errored')
  }

  // Filter out anything locally queued for deletion so a pull never resurrects
  // an item the user deleted before the push debounce fired.
  const { pendingDeletes } = useLibraryStore.getState()
  const { pendingDeletedNotes } = useNotesStore.getState()
  const { pendingDeletedExams } = useExamStore.getState()
  const pendingFolderSet  = new Set(pendingDeletes.folders)
  const pendingDeckSet    = new Set(pendingDeletes.decks)
  const pendingCardSet    = new Set(pendingDeletes.cards)
  const pendingSessionSet = new Set(pendingDeletes.sessions)
  const pendingLogSet     = new Set(pendingDeletes.reviewLogs)
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
    (sessionsRes.data ?? []).map((r) => toCamel(r) as ReviewSession).filter((s) => !pendingSessionSet.has(s.id))
  const reviewLogs = logsRes.error ? null :
    (logsRes.data ?? []).map((r) => toCamel(r) as ReviewLog).filter((l) => !pendingLogSet.has(l.id))
  const notes = notesRes.error ? null :
    (notesRes.data ?? []).map((r) => toCamel(r) as Note).filter((n) => !pendingNoteSet.has(n.id))
  const exams = examsRes.error ? null :
    (examsRes.data ?? []).map((r) => toCamel(r) as Exam).filter((e) => !pendingExamSet.has(e.id))

  // Build fsrsData record from server rows. null on error — preserve local.
  // Pre-filter to fetched card IDs to avoid re-upserting orphaned rows; the
  // setState merge below does a final pass using the full merged card set.
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
      ? (incremental ? mergeIncremental(decks, current.decks) : mergeKeepLocal(decks, current.decks, preExistingIds.decks))
      : current.decks
    const mergedDeckSet = new Set(mergedDecks.map((d) => d.id))

    // Remove cards whose deck no longer exists (orphans from deleted decks).
    const rawMergedCards = cards !== null
      ? (incremental ? mergeIncremental(cards, current.cards) : mergeKeepLocal(cards, current.cards, preExistingIds.cards))
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

    // Merge fsrsData: server wins for existing entries, prune orphans.
    const mergedFsrsData = fetchedFsrsData !== null
      ? Object.fromEntries(
          Object.entries({ ...current.fsrsData, ...fetchedFsrsData }).filter(([id]) => mergedCardSet.has(id))
        )
      : Object.fromEntries(Object.entries(current.fsrsData).filter(([id]) => mergedCardSet.has(id)))

    return {
      ...(folders !== null ? {
        folders: incremental
          ? mergeIncremental(folders, current.folders)
          : mergeKeepLocal(folders, current.folders, preExistingIds.folders),
      } : {}),
      decks: mergedDecks,
      cards: mergedCards,
      fsrsData: mergedFsrsData,
      ...(newOrphanIds.length > 0 ? {
        pendingDeletes: {
          ...current.pendingDeletes,
          cards: [...current.pendingDeletes.cards, ...newOrphanIds],
        },
      } : {}),
    }
  })

  if (sessions !== null || reviewLogs !== null) {
    useHistoryStore.setState((current) => ({
      ...(sessions !== null ? { sessions } : {}),
      ...(reviewLogs !== null ? { reviewLogs: mergeKeepLocal(reviewLogs, current.reviewLogs) } : {}),
    }))
  }

  if (notes !== null) {
    useNotesStore.setState((current) => ({
      notes: incremental
        ? mergeIncremental(notes, current.notes)
        : mergeKeepLocal(notes, current.notes, preExistingIds.notes),
    }))
  }

  if (exams !== null) {
    useExamStore.setState((current) => ({
      exams: incremental
        ? mergeIncremental(exams, current.exams)
        : mergeKeepLocal(exams, current.exams, preExistingIds.exams),
    }))
  }

  // user_settings is a single row, not a list — server always wins outright
  // when a row exists. No row yet (new user) means nothing to hydrate. On an
  // incremental pull, no row simply means settings haven't changed since the
  // watermark — local state is already correct, so this is a no-op either way.
  // fsrsWeights/targetRetention/dailyReviewLimit are `undefined`
  // (key absent from the row) rather than `null` if the migration adding
  // those columns hasn't been run on this database yet — must use `!= null`
  // (not `!== null`) so an absent key doesn't wipe local state to undefined.
  if (!settingsRes.error && settingsRes.data) {
    const s = toCamel(settingsRes.data) as {
      newCardsPerDay: number
      fsrsWeights?: number[] | null
      targetRetention?: number | null
      dailyReviewLimit?: number | null
    }
    useSettingsStore.setState({
      newCardsPerDay: s.newCardsPerDay,
      ...(s.fsrsWeights != null ? { fsrsWeights: s.fsrsWeights } : {}),
      ...(s.targetRetention != null ? { fsrsTargetRetention: s.targetRetention } : {}),
      ...(s.dailyReviewLimit != null ? { maxReviewsPerDay: s.dailyReviewLimit } : {}),
    })
  }

  // Seed dirty-tracking with what the server already has, so the next push
  // doesn't immediately re-upload rows we just pulled unchanged. The store
  // rows for server-fetched items are the exact toCamel(row) objects applied
  // above, so their JSON matches what the push-side dirty filter serializes.
  for (const row of fsrsRes.data ?? []) {
    const f = toCamel(row) as FSRSState
    lastPushedFsrs.set(f.cardId, JSON.stringify(f))
  }
  for (const f of folders ?? [])  lastPushedFolders.set(f.id, JSON.stringify(f))
  for (const d of decks ?? [])    lastPushedDecks.set(d.id, JSON.stringify(d))
  for (const c of cards ?? [])    lastPushedCards.set(c.id, JSON.stringify(c))
  for (const s of sessions ?? []) lastPushedSessions.set(s.id, JSON.stringify(s))
  if (!incremental) pushedLogIds.clear()
  for (const row of logsRes.data ?? []) {
    pushedLogIds.add((row as { id: string }).id)
  }

  // Advance the watermark only after every table above has been applied
  // successfully — using the timestamp captured before the fetches ran avoids
  // missing rows that changed mid-fetch. If any table errored (full pull —
  // incremental pulls already threw above), skip it so the next pull retries
  // as a full pull instead of an incremental one that would skip the rows
  // missed during this error window.
  if (!anyError) {
    setLastPullAt(pullStartedAt)
  } else {
    console.error('[SYNC] runPull: one or more tables errored during full pull — watermark not advanced')
  }
}

// ─── Push helpers ─────────────────────────────────────────────────────────────

// ─── Dirty tracking (push only rows that changed since the last successful
// push) ────────────────────────────────────────────────────────────────────
// fsrs_data is keyed by cardId and gets rewritten in full on every
// review; review_logs is append-only. Tracking what we've already sent lets
// repeated 400ms-debounced pushes skip rows that haven't changed, instead of
// re-upserting the entire table every cycle (181+ fsrs_data rows, an
// ever-growing review_logs array, etc.) — this was the dominant source of
// excess Supabase request volume. folders/decks/cards/review_sessions use the
// same JSON-snapshot-per-id pattern so a single card rating no longer
// re-uploads every row of those tables.
const lastPushedFsrs     = new Map<string, string>()
const lastPushedFolders  = new Map<string, string>()
const lastPushedDecks    = new Map<string, string>()
const lastPushedCards    = new Map<string, string>()
const lastPushedSessions = new Map<string, string>()
const pushedLogIds       = new Set<string>()

// Compare-and-swap guard — a device that was offline for a while must not
// blindly overwrite edits another device already pushed in the meantime.
// Only push a row if the local updatedAt is newer than or equal to what the
// server currently has for that id; rows dropped here stay "dirty" in the
// lastPushedX maps (never marked as pushed), so the next pull picks up the
// server's newer copy and the next push cycle naturally stops retrying.
async function dropStaleOverwrites<T extends { id: string; updatedAt: string }>(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  table: 'folders' | 'decks' | 'cards',
  rows: T[],
): Promise<T[]> {
  if (!rows.length) return rows
  const BATCH = 100
  const serverUpdatedAt = new Map<string, string>()
  for (let i = 0; i < rows.length; i += BATCH) {
    const ids = rows.slice(i, i + BATCH).map((r) => r.id)
    const res = await supabase.from(table).select('id, updated_at').eq('user_id', userId).in('id', ids)
    if (res.error) {
      // Can't verify server state — push anyway rather than silently dropping
      // a local edit because of a transient read failure.
      console.error(`[SYNC] pushToSupabase: CAS check failed on "${table}", pushing unconditionally`, formatPgError(res.error))
      return rows
    }
    for (const row of res.data ?? []) {
      serverUpdatedAt.set((row as { id: string }).id, (row as { updated_at: string }).updated_at)
    }
  }
  return rows.filter((r) => {
    const serverTs = serverUpdatedAt.get(r.id)
    if (!serverTs) return true // no server row yet — nothing to clobber
    return new Date(r.updatedAt).getTime() >= new Date(serverTs).getTime()
  })
}

async function pushToSupabase(
  folders: Folder[],
  decks: Deck[],
  cards: Card[],
  fsrsData: Record<string, FSRSState>,
  sessions: ReviewSession[],
  reviewLogs: ReviewLog[],
  pendingDeletes?: { folders: string[], decks: string[], cards: string[], sessions: string[], reviewLogs: string[] },
): Promise<void> {
  if (!isSupabaseConfigured()) {
    console.warn('[SYNC] pushToSupabase: Supabase not configured, skipping push')
    return
  }
  const supabase = createClient()
  const userId = await getCachedUserId(supabase)
  if (!userId) {
    console.warn('[SYNC] pushToSupabase: no authenticated user, skipping push')
    return
  }

  const upsertOpts = { onConflict: 'id' } as const
  const withUserId = (r: unknown) => ({ ...(toSnake(r) as PlainObject), user_id: userId })

  // PostgREST sends .in() filters as URL query params — large arrays exceed
  // server URL-length limits (~8KB). Batch deletes to stay well under that.
  const BATCH = 100

  if (DEBUG_SYNC) {
    console.log('[SYNC] pushToSupabase: upserting to Supabase as user', userId, {
      folders: (folders ?? []).length,
      decks: (decks ?? []).length,
      cards: (cards ?? []).length,
      fsrsData: Object.keys(fsrsData ?? {}).length,
      sessions: (sessions ?? []).length,
      reviewLogs: (reviewLogs ?? []).length,
    })
  }

  // Only upsert fsrs_data for cards that exist in the active card set.
  // This prevents orphaned entries (e.g. from a deleted deck whose cards were
  // briefly re-pulled from Supabase before the delete push ran) from being
  // written back. Also excludes cards about to be deleted to avoid a deadlock
  // (upsert + delete on the same row in the same push → PostgreSQL 40P01).
  const activeCardSet  = new Set(cards.map((c) => c.id))
  const cardDeleteSet  = new Set(pendingDeletes?.cards ?? [])

  // Clean up tracking maps for deleted rows so they don't grow unbounded.
  for (const id of cardDeleteSet) {
    lastPushedFsrs.delete(id)
    lastPushedCards.delete(id)
  }
  for (const id of pendingDeletes?.decks ?? [])   lastPushedDecks.delete(id)
  for (const id of pendingDeletes?.folders ?? []) lastPushedFolders.delete(id)
  for (const id of pendingDeletes?.sessions ?? [])   lastPushedSessions.delete(id)
  for (const id of pendingDeletes?.reviewLogs ?? []) pushedLogIds.delete(id)

  // Same deadlock avoidance as cards above: never upsert a session/log that's
  // also queued for deletion in this same push cycle.
  const sessionDeleteSet = new Set(pendingDeletes?.sessions ?? [])
  const logDeleteSet     = new Set(pendingDeletes?.reviewLogs ?? [])

  // Dirty filter: only upsert a row if its serialized contents differ from
  // what we last successfully pushed for that id.
  const foldersDirty = folders.filter((f) => lastPushedFolders.get(f.id) !== JSON.stringify(f))
  const decksDirty   = decks.filter((d) => lastPushedDecks.get(d.id) !== JSON.stringify(d))
  const cardsDirty   = cards.filter((c) => lastPushedCards.get(c.id) !== JSON.stringify(c))

  // CAS guard: drop any of the above whose server copy is newer than our
  // local one (see dropStaleOverwrites doc comment).
  const [foldersToUpsert, decksToUpsert, cardsToUpsert] = await Promise.all([
    dropStaleOverwrites(supabase, userId, 'folders', foldersDirty),
    dropStaleOverwrites(supabase, userId, 'decks', decksDirty),
    dropStaleOverwrites(supabase, userId, 'cards', cardsDirty),
  ])

  const sessionsToUpsert = sessions.filter((s) => !sessionDeleteSet.has(s.id) && lastPushedSessions.get(s.id) !== JSON.stringify(s))
  const fsrsToUpsert = Object.values(fsrsData).filter((f) => {
    if (!activeCardSet.has(f.cardId) || cardDeleteSet.has(f.cardId)) return false
    const serialized = JSON.stringify(f)
    return lastPushedFsrs.get(f.cardId) !== serialized
  })
  const reviewLogsToUpsert = reviewLogs.filter((l) => !logDeleteSet.has(l.id) && !pushedLogIds.has(l.id))

  // Upsert in batches — large payloads can exceed PostgREST body/row limits.
  async function upsertBatched<T>(
    table: 'folders' | 'decks' | 'cards' | 'fsrs_data' | 'review_sessions' | 'review_logs',
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
    foldersToUpsert.length
      ? upsertBatched('folders', foldersToUpsert.map(withUserId), upsertOpts)
      : null,
    decksToUpsert.length
      ? upsertBatched('decks', decksToUpsert.map(withUserId), upsertOpts)
      : null,
    cardsToUpsert.length
      ? upsertBatched(
          'cards',
          cardsToUpsert.map((c) => withUserId({ ...c, hint: c.hint ?? '', front: c.front ?? '', back: c.back ?? '' })),
          upsertOpts,
        )
      : null,
    fsrsToUpsert.length
      ? upsertBatched('fsrs_data', fsrsToUpsert.map(withUserId), { onConflict: 'card_id' })
      : null,
    sessionsToUpsert.length
      ? upsertBatched('review_sessions', sessionsToUpsert.map(withUserId), upsertOpts)
      : null,
    reviewLogsToUpsert.length
      ? upsertBatched('review_logs', reviewLogsToUpsert.map(withUserId), upsertOpts)
      : null,
  ])

  // Record what we just pushed so the next cycle can skip unchanged rows.
  for (const f of foldersToUpsert)  lastPushedFolders.set(f.id, JSON.stringify(f))
  for (const d of decksToUpsert)    lastPushedDecks.set(d.id, JSON.stringify(d))
  for (const c of cardsToUpsert)    lastPushedCards.set(c.id, JSON.stringify(c))
  for (const s of sessionsToUpsert) lastPushedSessions.set(s.id, JSON.stringify(s))
  for (const f of fsrsToUpsert) lastPushedFsrs.set(f.cardId, JSON.stringify(f))
  for (const l of reviewLogsToUpsert) pushedLogIds.add(l.id)

  if (DEBUG_SYNC) console.log('[SYNC] pushToSupabase: all upserts succeeded')

  // Execute pending deletes — cards first, then decks, then folders
  // so child rows are gone before their parents (avoids any implicit ordering issues).
  // Each delete is batched: .in() with hundreds of IDs exceeds PostgREST's URL
  // length limit and returns "Bad Request".
  if (pendingDeletes) {
    // pendingDeletes may come from state persisted before `sessions`/`reviewLogs`
    // were added to PendingDeletes, so those keys can be missing on old state.
    const delFolders    = pendingDeletes.folders ?? []
    const delDecks      = pendingDeletes.decks ?? []
    const delCards      = pendingDeletes.cards ?? []
    const delSessions   = pendingDeletes.sessions ?? []
    const delReviewLogs = pendingDeletes.reviewLogs ?? []
    if (delSessions.length) {
      for (let i = 0; i < delSessions.length; i += BATCH) {
        const chunk = delSessions.slice(i, i + BATCH)
        const delSessionsRes = await supabase.from('review_sessions').delete().in('id', chunk)
        if (delSessionsRes.error) {
          console.error('[SYNC] pushToSupabase: review_sessions delete error', formatPgError(delSessionsRes.error))
          throw new Error(`review_sessions delete: ${delSessionsRes.error.message} (code ${delSessionsRes.error.code})`)
        }
      }
    }
    if (delReviewLogs.length) {
      for (let i = 0; i < delReviewLogs.length; i += BATCH) {
        const chunk = delReviewLogs.slice(i, i + BATCH)
        const delLogs = await supabase.from('review_logs').delete().in('id', chunk)
        if (delLogs.error) {
          console.error('[SYNC] pushToSupabase: review_logs delete error', formatPgError(delLogs.error))
          throw new Error(`review_logs delete: ${delLogs.error.message} (code ${delLogs.error.code})`)
        }
      }
    }
    if (delCards.length) {
      for (let i = 0; i < delCards.length; i += BATCH) {
        const chunk = delCards.slice(i, i + BATCH)
        const delCardsRes = await supabase.from('cards').delete().in('id', chunk)
        if (delCardsRes.error) {
          console.error('[SYNC] pushToSupabase: cards delete error', formatPgError(delCardsRes.error))
          throw new Error(`cards delete: ${delCardsRes.error.message} (code ${delCardsRes.error.code})`)
        }
        const delFsrs = await supabase.from('fsrs_data').delete().in('card_id', chunk)
        if (delFsrs.error) {
          console.error('[SYNC] pushToSupabase: fsrs_data delete error', formatPgError(delFsrs.error))
          throw new Error(`fsrs_data delete: ${delFsrs.error.message} (code ${delFsrs.error.code})`)
        }
      }
    }
    if (delDecks.length) {
      for (let i = 0; i < delDecks.length; i += BATCH) {
        const chunk = delDecks.slice(i, i + BATCH)
        const delDecksRes = await supabase.from('decks').delete().in('id', chunk)
        if (delDecksRes.error) {
          console.error('[SYNC] pushToSupabase: decks delete error', formatPgError(delDecksRes.error))
          throw new Error(`decks delete: ${delDecksRes.error.message} (code ${delDecksRes.error.code})`)
        }
      }
    }
    if (delFolders.length) {
      for (let i = 0; i < delFolders.length; i += BATCH) {
        const chunk = delFolders.slice(i, i + BATCH)
        const delFoldersRes = await supabase.from('folders').delete().in('id', chunk)
        if (delFoldersRes.error) {
          console.error('[SYNC] pushToSupabase: folders delete error', formatPgError(delFoldersRes.error))
          throw new Error(`folders delete: ${delFoldersRes.error.message} (code ${delFoldersRes.error.code})`)
        }
      }
    }
    if (delFolders.length || delDecks.length || delCards.length || delSessions.length || delReviewLogs.length) {
      if (DEBUG_SYNC) console.log('[SYNC] pushToSupabase: deletes complete')
    }
  }
}

async function pushNotesToSupabase(notes: Note[], pendingDeletedNotes: string[]): Promise<void> {
  if (!isSupabaseConfigured()) return
  const supabase = createClient()
  const userId = await getCachedUserId(supabase)
  if (!userId) return

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
    notes.map((r) => ({ ...(toSnake(r) as PlainObject), user_id: userId })),
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
  const userId = await getCachedUserId(supabase)
  if (!userId) return

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
    exams.map((e) => ({ ...(toSnake(e) as PlainObject), user_id: userId })),
    { onConflict: 'id' },
  )
  if (res.error) {
    console.error('[SYNC] pushExamsToSupabase error:', formatPgError(res.error))
    throw new Error(`exams: ${res.error.message} (code ${res.error.code})`)
  }
}

// The SRS-relevant subset of settings that must schedule cards identically
// across devices — synced to user_settings with last-write-wins via
// updated_at, same as every other table.
export interface SyncedSettings {
  newCardsPerDay: number
  fsrsWeights: number[]
  fsrsTargetRetention: number
  maxReviewsPerDay: number
}

async function pushSettingsToSupabase(settings: SyncedSettings): Promise<void> {
  if (!isSupabaseConfigured()) return
  const supabase = createClient()
  const userId = await getCachedUserId(supabase)
  if (!userId) return

  const res = await supabase.from('user_settings').upsert(
    {
      user_id: userId,
      new_cards_per_day: settings.newCardsPerDay,
      fsrs_weights: settings.fsrsWeights,
      target_retention: settings.fsrsTargetRetention,
      daily_review_limit: settings.maxReviewsPerDay,
      updated_at: new Date().toISOString(),
    },
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
  const historyDebounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
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
  // True only for the one tab holding the 'nemos-sync-leader' Web Lock — see
  // the leader-election effect below. Gates the periodic/visibility pull so
  // ten open tabs don't all hammer Supabase every 5 minutes.
  const isLeaderRef = useRef(false)

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
        const h = useHistoryStore.getState()
        if (DEBUG_SYNC) console.log('[SYNC] handlePush: pushing', { decks: s.decks.map(d => ({ id: d.id, name: d.name })) })
        await pushToSupabase(s.folders, s.decks, s.cards, s.fsrsData, h.sessions, h.reviewLogs, s.pendingDeletes)
        // Clear only the IDs that were in this push — new deletes queued
        // while in-flight are preserved for the next push.
        // pendingDeletes may come from state persisted before `sessions`/`reviewLogs`
        // were added to PendingDeletes, so those keys can be missing on old state.
        const pdFolders    = s.pendingDeletes.folders ?? []
        const pdDecks      = s.pendingDeletes.decks ?? []
        const pdCards      = s.pendingDeletes.cards ?? []
        const pdSessions   = s.pendingDeletes.sessions ?? []
        const pdReviewLogs = s.pendingDeletes.reviewLogs ?? []
        if (pdFolders.length || pdDecks.length || pdCards.length || pdSessions.length || pdReviewLogs.length) {
          useLibraryStore.getState().clearPendingDeletes({
            folders: pdFolders,
            decks: pdDecks,
            cards: pdCards,
            sessions: pdSessions,
            reviewLogs: pdReviewLogs,
          })
          // Immediately tell other tabs which items were deleted so they strip
          // them from their local state before their own push acquires the lock.
          syncChannel.current?.postMessage({
            type: 'push-complete',
            deletedFolders: pdFolders,
            deletedDecks:   pdDecks,
            deletedCards:   pdCards,
            deletedSessions:   pdSessions,
            deletedReviewLogs: pdReviewLogs,
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

  const handleSettingsPush = useCallback(async (settings: SyncedSettings) => {
    setSyncing(true)
    setError(null)
    try {
      await pushSettingsToSupabase(settings)
      syncChannel.current?.postMessage({
        type: 'settings-push-complete',
        settings,
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
        if (DEBUG_SYNC) console.log('[SYNC] BroadcastChannel: another tab pushed settings changes, applying locally', e.data.settings)
        applyingRemoteRef.current = true
        useSettingsStore.setState(e.data.settings as SyncedSettings)
        applyingRemoteRef.current = false
        return
      }
      if (e.data?.type !== 'push-complete') return
      const deletedFolders: string[] = e.data.deletedFolders ?? []
      const deletedDecks: string[]   = e.data.deletedDecks   ?? []
      const deletedCards: string[]   = e.data.deletedCards   ?? []
      const deletedSessions: string[]   = e.data.deletedSessions   ?? []
      const deletedReviewLogs: string[] = e.data.deletedReviewLogs ?? []
      if (!deletedFolders.length && !deletedDecks.length && !deletedCards.length && !deletedSessions.length && !deletedReviewLogs.length) return
      if (DEBUG_SYNC) console.log('[SYNC] BroadcastChannel: another tab deleted items, applying locally', { deletedFolders, deletedDecks, deletedCards, deletedSessions, deletedReviewLogs })
      const fSet = new Set(deletedFolders)
      const dSet = new Set(deletedDecks)
      const cSet = new Set(deletedCards)
      const sSet = new Set(deletedSessions)
      const lSet = new Set(deletedReviewLogs)
      applyingRemoteRef.current = true
      useLibraryStore.setState((s) => ({
        folders: s.folders.filter((f) => !fSet.has(f.id)),
        decks:   s.decks.filter((d)   => !dSet.has(d.id)),
        cards:   s.cards.filter((c)   => !cSet.has(c.id)),
        fsrsData: Object.fromEntries(Object.entries(s.fsrsData).filter(([id]) => !cSet.has(id))),
        pendingDeletes: {
          folders:    s.pendingDeletes.folders.filter((id) => !fSet.has(id)),
          decks:      s.pendingDeletes.decks.filter((id)   => !dSet.has(id)),
          cards:      s.pendingDeletes.cards.filter((id)   => !cSet.has(id)),
          sessions:   s.pendingDeletes.sessions.filter((id) => !sSet.has(id)),
          reviewLogs: s.pendingDeletes.reviewLogs.filter((id) => !lSet.has(id)),
        },
      }))
      if (deletedSessions.length || deletedReviewLogs.length) {
        useHistoryStore.setState((s) => ({
          sessions:   s.sessions.filter((sess) => !sSet.has(sess.id)),
          reviewLogs: s.reviewLogs.filter((l) => !lSet.has(l.id)),
        }))
      }
      applyingRemoteRef.current = false
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
      await useHistoryStore.persist.rehydrate()
      await useNotesStore.persist.rehydrate()
      await useExamStore.persist.rehydrate()
      await useSettingsStore.persist.rehydrate()
      // Lift reviewLogs/sessions out of an old-format library blob into the
      // history store. No-op once migrated.
      migrateHistoryToOwnStore()
      // Strip the removed SM-2 srsData blob / settings keys from persisted
      // state. No-op once stripped.
      stripLegacySm2State()
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
          if (state.folders.length || state.decks.length || state.cards.length || state.pendingDeletes.folders.length || state.pendingDeletes.decks.length || state.pendingDeletes.cards.length || state.pendingDeletes.sessions.length || state.pendingDeletes.reviewLogs.length) {
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
          const settingsState = useSettingsStore.getState()
          handleSettingsPush({
            newCardsPerDay: settingsState.newCardsPerDay,
            fsrsWeights: settingsState.fsrsWeights,
            fsrsTargetRetention: settingsState.fsrsTargetRetention,
            maxReviewsPerDay: settingsState.maxReviewsPerDay,
          })
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

  // Leader election — exactly one open tab holds the 'nemos-sync-leader' Web
  // Lock at a time (auto-released on tab close/reload), so periodic/visibility
  // pulls below fire once across all tabs instead of once per tab. Realtime +
  // BroadcastChannel already keep non-leader tabs current between pulls.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('locks' in navigator)) {
      // No Web Locks support — assume single-tab usage rather than never pulling.
      isLeaderRef.current = true
      return
    }
    let releaseLock: (() => void) | null = null
    navigator.locks.request('nemos-sync-leader', () => {
      isLeaderRef.current = true
      if (DEBUG_SYNC) console.log('[SYNC] this tab elected leader')
      return new Promise<void>((resolve) => { releaseLock = resolve })
    }).catch(() => {})
    return () => {
      isLeaderRef.current = false
      releaseLock?.()
    }
  }, [])

  // Periodic + visibility-triggered incremental pull — without this, a tab left
  // open all day only learns about another device's reviews via the review_logs
  // realtime feed, never the fsrs_data scheduling changes that go with
  // them, so its due queue silently drifts until a manual reload.
  useEffect(() => {
    function incrementalPullIfLeader() {
      if (!isLeaderRef.current) return
      if (typeof navigator !== 'undefined' && !navigator.onLine) return
      if (DEBUG_SYNC) console.log('[SYNC] leader tab: periodic/visibility incremental pull')
      pullFromSupabase().catch((err: unknown) => {
        console.error('[SYNC] periodic/visibility pull failed', err)
      })
    }
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') incrementalPullIfLeader()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    const intervalId = setInterval(incrementalPullIfLeader, 5 * 60 * 1000)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      clearInterval(intervalId)
    }
  }, [])

  // Subscribe to library store changes with a 400ms debounce
  useEffect(() => {
    const unsub = useLibraryStore.subscribe(() => {
      if (!mountedRef.current) {
        if (DEBUG_SYNC) console.log('[SYNC] store change ignored — mountedRef is false (pull not yet complete)')
        return
      }
      if (applyingRemoteRef.current) return
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

  // Subscribe to history store changes with a 400ms debounce — review logs
  // and sessions live in their own persisted store, but push through the
  // same pipeline (and dirty tracking keeps repeat pushes cheap).
  useEffect(() => {
    const unsub = useHistoryStore.subscribe(() => {
      if (!mountedRef.current) return
      if (applyingRemoteRef.current) return
      if (historyDebounceRef.current) clearTimeout(historyDebounceRef.current)
      historyDebounceRef.current = setTimeout(() => {
        handlePush()
      }, 400)
    })
    return () => {
      unsub()
      if (historyDebounceRef.current) clearTimeout(historyDebounceRef.current)
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
  // SRS-relevant fields (newCardsPerDay, fsrsWeights, fsrsTargetRetention,
  // maxReviewsPerDay) are synced; everything else stays local-only.
  useEffect(() => {
    const unsub = useSettingsStore.subscribe((state) => {
      if (!mountedRef.current || applyingRemoteRef.current) return
      if (settingsDebounceRef.current) clearTimeout(settingsDebounceRef.current)
      settingsDebounceRef.current = setTimeout(() => {
        handleSettingsPush({
          newCardsPerDay: state.newCardsPerDay,
          fsrsWeights: state.fsrsWeights,
          fsrsTargetRetention: state.fsrsTargetRetention,
          maxReviewsPerDay: state.maxReviewsPerDay,
        })
      }, 400)
    })
    return () => {
      unsub()
      if (settingsDebounceRef.current) clearTimeout(settingsDebounceRef.current)
    }
  }, [handleSettingsPush])

  // Supabase Realtime subscriptions — merge individual rows instead of full pull.
  // Subscriptions are filtered to this user's rows (without the filter, every
  // table broadcast — including other users' writes under permissive publication
  // configs — reaches every client), and each handler drops echo events (our own
  // writes broadcast back) by deep-comparing the incoming row to local state
  // before touching the store.
  useEffect(() => {
    if (!isSupabaseConfigured()) return
    const supabase = createClient()
    let channel: ReturnType<typeof supabase.channel> | null = null
    let cancelled = false

    const setup = async () => {
      let userId: string | null = null
      try {
        userId = await getCachedUserId(supabase)
      } catch (err) {
        console.error('[SYNC] realtime setup: failed to resolve user id', err)
        return
      }
      if (!userId || cancelled) return
      const userFilter = `user_id=eq.${userId}`

      channel = supabase.channel(`nemos-realtime-${Math.random().toString(36).slice(2)}`)

      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'folders', filter: userFilter },
        (payload) => {
          const { eventType, new: newRow, old: oldRow } = payload
          if (eventType === 'INSERT' || eventType === 'UPDATE') {
            const folder = toCamel(newRow) as Folder
            // Echo of our own push — local state already matches, skip the
            // setState so the store subscriber never fires.
            const existing = useLibraryStore.getState().folders.find((f) => f.id === folder.id)
            if (existing && deepEqual(existing, folder)) return
            lastPushedFolders.set(folder.id, JSON.stringify(folder))
            applyingRemoteRef.current = true
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
            applyingRemoteRef.current = false
          } else if (eventType === 'DELETE') {
            const id = (oldRow as { id: string }).id
            lastPushedFolders.delete(id)
            applyingRemoteRef.current = true
            useLibraryStore.setState((state) => ({
              folders: state.folders.filter((f) => f.id !== id),
            }))
            applyingRemoteRef.current = false
          }
        },
      )

      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'decks', filter: userFilter },
        (payload) => {
          const { eventType, new: newRow, old: oldRow } = payload
          if (eventType === 'INSERT' || eventType === 'UPDATE') {
            const deck = toCamel(newRow) as Deck
            const existing = useLibraryStore.getState().decks.find((d) => d.id === deck.id)
            if (existing && deepEqual(existing, deck)) return
            lastPushedDecks.set(deck.id, JSON.stringify(deck))
            applyingRemoteRef.current = true
            useLibraryStore.setState((state) => {
              if (state.pendingDeletes.decks.includes(deck.id)) return {}
              const exists = state.decks.some((d) => d.id === deck.id)
              return {
                decks: exists
                  ? state.decks.map((d) => d.id === deck.id ? deck : d)
                  : [...state.decks, deck],
              }
            })
            applyingRemoteRef.current = false
          } else if (eventType === 'DELETE') {
            const id = (oldRow as { id: string }).id
            lastPushedDecks.delete(id)
            applyingRemoteRef.current = true
            useLibraryStore.setState((state) => ({
              decks: state.decks.filter((d) => d.id !== id),
            }))
            applyingRemoteRef.current = false
          }
        },
      )

      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cards', filter: userFilter },
        (payload) => {
          const { eventType, new: newRow, old: oldRow } = payload
          if (eventType === 'INSERT' || eventType === 'UPDATE') {
            const card = toCamel(newRow) as Card
            const existing = useLibraryStore.getState().cards.find((c) => c.id === card.id)
            if (existing && deepEqual(existing, card)) return
            lastPushedCards.set(card.id, JSON.stringify(card))
            applyingRemoteRef.current = true
            useLibraryStore.setState((state) => {
              if (state.pendingDeletes.cards.includes(card.id)) return {}
              const exists = state.cards.some((c) => c.id === card.id)
              return {
                cards: exists
                  ? state.cards.map((c) => c.id === card.id ? card : c)
                  : [...state.cards, card],
              }
            })
            applyingRemoteRef.current = false
          } else if (eventType === 'DELETE') {
            const id = (oldRow as { id: string }).id
            lastPushedCards.delete(id)
            applyingRemoteRef.current = true
            useLibraryStore.setState((state) => ({
              cards: state.cards.filter((c) => c.id !== id),
            }))
            applyingRemoteRef.current = false
          }
        },
      )

      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'review_logs', filter: userFilter },
        (payload) => {
          const { eventType, new: newRow, old: oldRow } = payload
          if (eventType === 'INSERT' || eventType === 'UPDATE') {
            const log = toCamel(newRow) as ReviewLog
            const existing = useHistoryStore.getState().reviewLogs.find((l) => l.id === log.id)
            if (existing && deepEqual(existing, log)) return
            pushedLogIds.add(log.id)
            applyingRemoteRef.current = true
            useHistoryStore.setState((state) => {
              const exists = state.reviewLogs.some((l) => l.id === log.id)
              return {
                reviewLogs: exists
                  ? state.reviewLogs.map((l) => l.id === log.id ? log : l)
                  : [...state.reviewLogs, log],
              }
            })
            applyingRemoteRef.current = false
          } else if (eventType === 'DELETE') {
            const id = (oldRow as { id: string }).id
            applyingRemoteRef.current = true
            useHistoryStore.setState((state) => ({
              reviewLogs: state.reviewLogs.filter((l) => l.id !== id),
            }))
            applyingRemoteRef.current = false
          }
        },
      )

      const channelName = channel.topic
      if (DEBUG_SYNC) console.log('[SYNC] realtime channel subscribing:', channelName)
      channel.subscribe((status) => {
        if (DEBUG_SYNC) console.log('[SYNC] realtime channel status:', channelName, status)
      })
    }

    setup()

    return () => {
      cancelled = true
      if (channel) {
        if (DEBUG_SYNC) console.log('[SYNC] realtime channel unsubscribing:', channel.topic)
        supabase.removeChannel(channel)
      }
    }
  }, [])

  const manualPush = useCallback(async () => {
    await handlePush()
  }, [handlePush])

  return { syncing, lastSynced, error, offline, manualPush }
}
