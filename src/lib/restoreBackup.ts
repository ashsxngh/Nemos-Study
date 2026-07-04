'use client'

import { importFromJSON, type ImportedBackup } from '@/lib/import'
import { useLibraryStore } from '@/store/useLibraryStore'

/**
 * Parses a Nemo backup JSON and applies it to the library store as a full
 * replacement — the backup's folders, decks, cards, and FSRS data overwrite
 * the current library outright (restore, not merge). Throws on invalid JSON
 * so the caller can surface a visible error.
 */
export function restoreBackup(jsonText: string): ImportedBackup {
  const backup = importFromJSON(jsonText)
  useLibraryStore.setState({
    folders: backup.folders,
    decks: backup.decks,
    cards: backup.cards,
    fsrsData: backup.fsrsData,
  })
  return backup
}
