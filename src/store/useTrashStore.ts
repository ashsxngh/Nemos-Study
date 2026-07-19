'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Card, Deck, Note, ReviewLog } from '@/lib/types'
import type { FSRSState } from '@/lib/srs'

const TRASH_TTL_MS = 14 * 24 * 60 * 60 * 1000 // 14 days

export interface TrashEntry {
  id: string
  type: 'card' | 'deck' | 'note'
  deletedAt: string

  // Display
  name: string
  parentName?: string
  snippet?: string
  cardCount?: number

  // Restoration payloads
  card?: Card
  cardFSRS?: FSRSState
  // Review logs pruned from history when this card was deleted. Stored so undo
  // can put them back — deleting a card removes its logs locally AND queues
  // them for server deletion; without this the history is lost on restore.
  cardLogs?: ReviewLog[]
  deck?: Deck
  deckCards?: Card[]
  deckFSRS?: Record<string, FSRSState>
  note?: Note
}

interface TrashState {
  items: TrashEntry[]
  add: (entry: TrashEntry) => void
  remove: (id: string) => void
  purgeExpired: () => void
  clear: () => void
}

export const useTrashStore = create<TrashState>()(
  persist(
    (set) => ({
      items: [],

      add: (entry) => {
        set((s) => ({
          // Deduplicate by id — if the same item is re-deleted, replace the old entry
          items: [entry, ...s.items.filter((i) => i.id !== entry.id)],
        }))
      },

      remove: (id) => {
        set((s) => ({ items: s.items.filter((i) => i.id !== id) }))
      },

      purgeExpired: () => {
        const cutoff = Date.now() - TRASH_TTL_MS
        set((s) => ({
          items: s.items.filter((i) => new Date(i.deletedAt).getTime() > cutoff),
        }))
      },

      clear: () => set({ items: [] }),
    }),
    { name: 'nemos-trash' }
  )
)
