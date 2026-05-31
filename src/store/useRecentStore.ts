'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const MAX_RECENT = 5

interface RecentState {
  recentDeckIds: string[]
  recentNoteIds: string[]
  visitDeck: (deckId: string) => void
  visitNote: (noteId: string) => void
}

export const useRecentStore = create<RecentState>()(
  persist(
    (set) => ({
      recentDeckIds: [],
      recentNoteIds: [],

      visitDeck: (deckId) =>
        set((s) => {
          const filtered = s.recentDeckIds.filter((id) => id !== deckId)
          return { recentDeckIds: [deckId, ...filtered].slice(0, MAX_RECENT) }
        }),

      visitNote: (noteId) =>
        set((s) => {
          const filtered = s.recentNoteIds.filter((id) => id !== noteId)
          return { recentNoteIds: [noteId, ...filtered].slice(0, MAX_RECENT) }
        }),
    }),
    {
      name: 'nemos-recent',
    }
  )
)
