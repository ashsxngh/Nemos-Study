'use client'

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { ReviewLog, ReviewSession } from '@/lib/types'
import { createIDBStorage } from '@/lib/idbStorage'
import { generateId } from '@/lib/utils'

const USER_ID = 'local-user'

// Append-only review history, split out of useLibraryStore so that persisting
// a card edit no longer re-serializes the entire review history (and vice
// versa) — zustand persist JSON.stringifies the whole store on every set(),
// which at scale meant every single card rating serialized 16MB+ of logs.
interface HistoryState {
  reviewLogs: ReviewLog[]
  sessions: ReviewSession[]

  addReviewLog: (log: ReviewLog) => void
  removeLastLog: () => void
  // Drops history belonging to deleted cards/decks (called by the library
  // store's deleteFolder/deleteDeck). Returns the ids removed so the caller
  // can queue them for remote deletion (see PendingDeletes.sessions/reviewLogs).
  pruneHistory: (cardIds: Set<string>, deckIds: Set<string>) => { sessionIds: string[]; logIds: string[] }

  startSession: (deckId?: string, mode?: ReviewSession['mode']) => ReviewSession
  endSession: (sessionId: string, cardsReviewed: number, correct: number) => void
}

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set) => ({
      reviewLogs: [],
      sessions: [],

      addReviewLog: (log) => {
        set((s) => ({ reviewLogs: [...s.reviewLogs, log] }))
      },

      removeLastLog: () => {
        set((s) => ({ reviewLogs: s.reviewLogs.slice(0, -1) }))
      },

      pruneHistory: (cardIds, deckIds) => {
        let sessionIds: string[] = []
        let logIds: string[] = []
        set((s) => {
          const keptLogs = s.reviewLogs.filter((l) => !cardIds.has(l.cardId))
          const keptSessions = s.sessions.filter((sess) => !deckIds.has(sess.deckId ?? ''))
          logIds = s.reviewLogs.filter((l) => cardIds.has(l.cardId)).map((l) => l.id)
          sessionIds = s.sessions.filter((sess) => deckIds.has(sess.deckId ?? '')).map((sess) => sess.id)
          return { reviewLogs: keptLogs, sessions: keptSessions }
        })
        return { sessionIds, logIds }
      },

      startSession: (deckId, mode = 'standard') => {
        const session: ReviewSession = {
          id: generateId(),
          userId: USER_ID,
          deckId,
          startedAt: new Date().toISOString(),
          cardsReviewed: 0,
          cardsCorrect: 0,
          cardsIncorrect: 0,
          averageResponseMs: 0,
          mode,
        }
        set((s) => ({ sessions: [...s.sessions, session] }))
        return session
      },

      endSession: (sessionId, cardsReviewed, correct) => {
        set((s) => ({
          sessions: s.sessions.map((sess) =>
            sess.id === sessionId
              ? {
                  ...sess,
                  endedAt: new Date().toISOString(),
                  cardsReviewed,
                  cardsCorrect: correct,
                  cardsIncorrect: cardsReviewed - correct,
                }
              : sess
          ),
        }))
      },
    }),
    {
      name: 'nemos-history',
      skipHydration: true,
      storage: createJSONStorage(createIDBStorage),
    }
  )
)
