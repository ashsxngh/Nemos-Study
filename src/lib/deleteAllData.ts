'use client'

import { createClient, isSupabaseConfigured, getCachedUserId } from '@/lib/supabase/client'
import { useLibraryStore } from '@/store/useLibraryStore'
import { useHistoryStore } from '@/store/useHistoryStore'
import { useNotesStore } from '@/store/useNotesStore'
import { useExamStore } from '@/store/useExamStore'
import { useTrashStore } from '@/store/useTrashStore'
import { useRecentStore } from '@/store/useRecentStore'

// Every user-owned table. All are filtered by user_id on delete; there are no
// inter-table FK constraints between them (e.g. cards.deck_id is a plain uuid),
// so deletion order is irrelevant.
const USER_TABLES = [
  'review_logs',
  'review_sessions',
  'fsrs_data',
  'cards',
  'decks',
  'folders',
  'notes',
  'exams',
  'user_settings',
] as const

/**
 * Permanently deletes ALL of the signed-in user's data from Supabase and clears
 * the local Zustand stores. Throws if any Supabase delete fails so the caller
 * can surface a visible error (never fail silently).
 */
export async function deleteAllData(): Promise<void> {
  // 1. Delete from Supabase (only if configured and signed in).
  if (isSupabaseConfigured()) {
    const supabase = createClient()
    const userId = await getCachedUserId(supabase)

    if (userId) {
      const errors: string[] = []
      for (const table of USER_TABLES) {
        const { error } = await supabase.from(table).delete().eq('user_id', userId)
        if (error) errors.push(`${table}: ${error.message}`)
      }
      if (errors.length > 0) {
        throw new Error(`Failed to delete from Supabase — ${errors.join('; ')}`)
      }
    }
  }

  // 2. Clear all local stores. Do this only after the server delete succeeds so
  // that a failed server delete doesn't leave the user with empty local data
  // that a subsequent pull would just re-download.
  useLibraryStore.setState({
    folders: [],
    decks: [],
    cards: [],
    fsrsData: {},
    pendingDeletes: { folders: [], decks: [], cards: [], sessions: [], reviewLogs: [] },
  })
  useHistoryStore.setState({ reviewLogs: [], sessions: [] })
  useNotesStore.setState({ notes: [], pendingDeletedNotes: [] })
  useExamStore.setState({ exams: [], pendingDeletedExams: [] })
  useTrashStore.setState({ items: [] })
  useRecentStore.setState({ recentDeckIds: [], recentNoteIds: [] })

  // 3. Reset the pull watermark so the next sync does a clean full pull against
  // the now-empty server rather than an incremental one.
  try {
    sessionStorage.removeItem('nemos-last-pull-at')
  } catch {
    /* sessionStorage may be unavailable; non-fatal */
  }
}
