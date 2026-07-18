'use client'

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { Note } from '@/lib/types'
import { useTrashStore } from '@/store/useTrashStore'
import { generateId } from '@/lib/utils'
import { NOTE_CONTENT_MAX_LENGTH, NAME_MAX_LENGTH } from '@/lib/limits'

function clamp(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) : str
}

const USER_ID = 'local-user'

interface NoteState {
  notes: Note[]
  pendingDeletedNotes: string[]
  createNote: (title?: string, folderId?: string) => Note
  updateNote: (id: string, updates: Partial<Pick<Note, 'title' | 'content' | 'tags' | 'isStarred' | 'isArchived'>>) => void
  deleteNote: (id: string) => void
  clearPendingDeletedNotes: (ids: string[]) => void
  getNotesByFolder: (folderId?: string | null) => Note[]
}

export const useNotesStore = create<NoteState>()(
  persist(
    (set, get) => ({
      notes: [],
      pendingDeletedNotes: [],

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
          createdAt: now,
          updatedAt: now,
        }
        set((s) => ({ notes: [...s.notes, note] }))
        return note
      },

      updateNote: (id, updates) => {
        const clamped = { ...updates }
        if (clamped.title !== undefined) clamped.title = clamp(clamped.title, NAME_MAX_LENGTH)
        if (clamped.content !== undefined) clamped.content = clamp(clamped.content, NOTE_CONTENT_MAX_LENGTH)
        set((s) => ({
          notes: s.notes.map((n) =>
            n.id === id ? { ...n, ...clamped, updatedAt: new Date().toISOString() } : n
          ),
        }))
      },

      deleteNote: (id) => {
        const note = get().notes.find((n) => n.id === id)
        if (note) {
          useTrashStore.getState().add({
            id: note.id,
            type: 'note',
            deletedAt: new Date().toISOString(),
            name: note.title || 'Untitled',
            snippet: note.content?.replace(/[#*`>_~]/g, '').slice(0, 120),
            note,
          })
        }
        set((s) => ({
          notes: s.notes.filter((n) => n.id !== id),
          pendingDeletedNotes: [...s.pendingDeletedNotes, id],
        }))
      },

      clearPendingDeletedNotes: (ids) => {
        const idSet = new Set(ids)
        set((s) => ({
          pendingDeletedNotes: s.pendingDeletedNotes.filter((id) => !idSet.has(id)),
        }))
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
      storage: createJSONStorage(() => localStorage),
    }
  )
)
