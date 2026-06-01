'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Note } from '@/lib/types'
import { generateId } from '@/lib/utils'

const USER_ID = 'local-user'

interface NoteState {
  notes: Note[]
  createNote: (title?: string, folderId?: string) => Note
  updateNote: (id: string, updates: Partial<Pick<Note, 'title' | 'content' | 'tags' | 'isStarred' | 'isArchived'>>) => void
  deleteNote: (id: string) => void
  getNotesByFolder: (folderId?: string | null) => Note[]
}

export const useNotesStore = create<NoteState>()(
  persist(
    (set, get) => ({
      notes: [],

      createNote: (title = '', folderId) => {
        const now = new Date().toISOString()
        const note: Note = {
          id: generateId(),
          userId: USER_ID,
          folderId: folderId ?? null,
          title,
          content: '',
          isStarred: false,
          isArchived: false,
          tags: [],
          linkedNoteIds: [],
          embeddedCardIds: [],
          createdAt: now,
          updatedAt: now,
        }
        set((s) => ({ notes: [...s.notes, note] }))
        return note
      },

      updateNote: (id, updates) => {
        set((s) => ({
          notes: s.notes.map((n) =>
            n.id === id ? { ...n, ...updates, updatedAt: new Date().toISOString() } : n
          ),
        }))
      },

      deleteNote: (id) => {
        set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }))
      },

      getNotesByFolder: (folderId) => {
        const { notes } = get()
        if (folderId === undefined || folderId === null) return notes
        return notes.filter((n) => n.folderId === folderId)
      },
    }),
    {
      name: 'nemos-notes',
      skipHydration: true,
    }
  )
)
