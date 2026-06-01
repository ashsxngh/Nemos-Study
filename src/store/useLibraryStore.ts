'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Folder, Deck, Card, SRSData, ReviewLog, ReviewSession, FolderColor, CardType } from '@/lib/types'
import {
  createInitialSRSData,
  scheduleCard,
  isDue,
  fsrsInitCard,
  fsrsSchedule,
  DEFAULT_FSRS_PARAMS,
} from '@/lib/srs'
import type { FSRSState } from '@/lib/srs'
import { useSettingsStore } from '@/store/useSettingsStore'
import { generateId } from '@/lib/utils'

const USER_ID = 'local-user'

interface LibraryState {
  folders: Folder[]
  decks: Deck[]
  cards: Card[]
  srsData: Record<string, SRSData>
  fsrsData: Record<string, FSRSState>
  reviewLogs: ReviewLog[]
  sessions: ReviewSession[]

  // Folder actions
  createFolder: (name: string, parentId?: string | null, color?: FolderColor) => Folder
  updateFolder: (id: string, updates: Partial<Pick<Folder, 'name' | 'color' | 'isStarred' | 'isArchived' | 'order' | 'parentId'>>) => void
  deleteFolder: (id: string) => void

  // Deck actions
  createDeck: (name: string, folderId?: string | null, description?: string) => Deck
  updateDeck: (id: string, updates: Partial<Pick<Deck, 'name' | 'description' | 'folderId' | 'isStarred' | 'isArchived' | 'tags' | 'order'>>) => void
  deleteDeck: (id: string) => void

  // Card actions
  createCard: (deckId: string, front: string, back: string, type?: CardType) => Card
  updateCard: (id: string, updates: Partial<Pick<Card, 'front' | 'back' | 'type' | 'hint' | 'tags' | 'isPinned' | 'isArchived' | 'order'>>) => void
  deleteCard: (id: string) => void

  // SRS actions
  initCardSRS: (cardId: string) => void
  reviewCard: (cardId: string, rating: 1 | 2 | 3 | 4) => void
  setSRSData: (cardId: string, srs: SRSData) => void
  removeLastLog: () => void
  resetCardSRS: (cardId: string) => void

  // Query helpers
  getDueCards: (deckId?: string) => Card[]
  getDeckCards: (deckId: string) => Card[]
  getFolderChildren: (folderId: string | null) => Folder[]
  getDeckMastery: (deckId: string) => number

  // Session
  startSession: (deckId?: string) => ReviewSession
  endSession: (sessionId: string, cardsReviewed: number, correct: number) => void
}

function getAllDescendantFolderIds(folders: Folder[], rootId: string): string[] {
  const direct = folders.filter((f) => f.parentId === rootId).map((f) => f.id)
  return direct.flatMap((id) => [id, ...getAllDescendantFolderIds(folders, id)])
}

export const useLibraryStore = create<LibraryState>()(
  persist(
    (set, get) => ({
      folders: [],
      decks: [],
      cards: [],
      srsData: {},
      fsrsData: {},
      reviewLogs: [],
      sessions: [],

      // ── Folder actions ──────────────────────────────────────────────────────
      createFolder: (name, parentId = null, color = 'default') => {
        const now = new Date().toISOString()
        const folder: Folder = {
          id: generateId(),
          userId: USER_ID,
          parentId: parentId ?? null,
          name,
          color,
          isStarred: false,
          isArchived: false,
          order: get().folders.length,
          createdAt: now,
          updatedAt: now,
        }
        set((s) => ({ folders: [...s.folders, folder] }))
        return folder
      },

      updateFolder: (id, updates) => {
        set((s) => ({
          folders: s.folders.map((f) =>
            f.id === id ? { ...f, ...updates, updatedAt: new Date().toISOString() } : f
          ),
        }))
      },

      deleteFolder: (id) => {
        const { folders, decks, cards, srsData, fsrsData } = get()
        const descendantIds = getAllDescendantFolderIds(folders, id)
        const allFolderIds = [id, ...descendantIds]
        const deckIdsToDelete = decks.filter((d) => d.folderId && allFolderIds.includes(d.folderId)).map((d) => d.id)
        const cardIdsToDelete = cards.filter((c) => deckIdsToDelete.includes(c.deckId)).map((c) => c.id)
        const newSrsData = { ...srsData }
        const newFsrsData = { ...fsrsData }
        cardIdsToDelete.forEach((cid) => {
          delete newSrsData[cid]
          delete newFsrsData[cid]
        })
        set({
          folders: folders.filter((f) => !allFolderIds.includes(f.id)),
          decks: decks.filter((d) => !deckIdsToDelete.includes(d.id)),
          cards: cards.filter((c) => !cardIdsToDelete.includes(c.id)),
          srsData: newSrsData,
          fsrsData: newFsrsData,
        })
      },

      // ── Deck actions ────────────────────────────────────────────────────────
      createDeck: (name, folderId = null, description = '') => {
        const now = new Date().toISOString()
        const deck: Deck = {
          id: generateId(),
          userId: USER_ID,
          folderId: folderId ?? null,
          name,
          description,
          isStarred: false,
          isArchived: false,
          tags: [],
          order: get().decks.length,
          createdAt: now,
          updatedAt: now,
        }
        set((s) => ({ decks: [...s.decks, deck] }))
        return deck
      },

      updateDeck: (id, updates) => {
        set((s) => ({
          decks: s.decks.map((d) =>
            d.id === id ? { ...d, ...updates, updatedAt: new Date().toISOString() } : d
          ),
        }))
      },

      deleteDeck: (id) => {
        const { cards, srsData, fsrsData } = get()
        const cardIdsToDelete = cards.filter((c) => c.deckId === id).map((c) => c.id)
        const newSrsData = { ...srsData }
        const newFsrsData = { ...fsrsData }
        cardIdsToDelete.forEach((cid) => {
          delete newSrsData[cid]
          delete newFsrsData[cid]
        })
        set((s) => ({
          decks: s.decks.filter((d) => d.id !== id),
          cards: s.cards.filter((c) => c.deckId !== id),
          srsData: newSrsData,
          fsrsData: newFsrsData,
        }))
      },

      // ── Card actions ────────────────────────────────────────────────────────
      createCard: (deckId, front, back, type = 'basic') => {
        const now = new Date().toISOString()
        const card: Card = {
          id: generateId(),
          deckId,
          userId: USER_ID,
          type,
          front,
          back,
          tags: [],
          isPinned: false,
          isArchived: false,
          linkedCardIds: [],
          prerequisiteCardIds: [],
          order: get().cards.filter((c) => c.deckId === deckId).length,
          createdAt: now,
          updatedAt: now,
        }
        const srs = createInitialSRSData(card.id, USER_ID)
        const fsrs = fsrsInitCard(card.id, USER_ID)
        set((s) => ({
          cards: [...s.cards, card],
          srsData: { ...s.srsData, [card.id]: srs },
          fsrsData: { ...s.fsrsData, [card.id]: fsrs },
        }))
        return card
      },

      updateCard: (id, updates) => {
        set((s) => ({
          cards: s.cards.map((c) =>
            c.id === id ? { ...c, ...updates, updatedAt: new Date().toISOString() } : c
          ),
        }))
      },

      deleteCard: (id) => {
        const newSrsData = { ...get().srsData }
        const newFsrsData = { ...get().fsrsData }
        delete newSrsData[id]
        delete newFsrsData[id]
        set((s) => ({
          cards: s.cards.filter((c) => c.id !== id),
          srsData: newSrsData,
          fsrsData: newFsrsData,
        }))
      },

      // ── SRS actions ─────────────────────────────────────────────────────────
      initCardSRS: (cardId) => {
        const { srsData, fsrsData } = get()
        if (!srsData[cardId]) {
          set((s) => ({ srsData: { ...s.srsData, [cardId]: createInitialSRSData(cardId, USER_ID) } }))
        }
        if (!fsrsData[cardId]) {
          set((s) => ({ fsrsData: { ...s.fsrsData, [cardId]: fsrsInitCard(cardId, USER_ID) } }))
        }
      },

      setSRSData: (cardId, srs) => {
        set((s) => ({ srsData: { ...s.srsData, [cardId]: srs } }))
      },

      removeLastLog: () => {
        set((s) => ({ reviewLogs: s.reviewLogs.slice(0, -1) }))
      },

      resetCardSRS: (cardId) => {
        const newSrsData = { ...get().srsData }
        const newFsrsData = { ...get().fsrsData }
        delete newSrsData[cardId]
        delete newFsrsData[cardId]
        set({ srsData: newSrsData, fsrsData: newFsrsData })
        // Re-init fresh
        set((s) => ({
          srsData: { ...s.srsData, [cardId]: createInitialSRSData(cardId, USER_ID) },
          fsrsData: { ...s.fsrsData, [cardId]: fsrsInitCard(cardId, USER_ID) },
        }))
      },

      reviewCard: (cardId, rating) => {
        const {
          algorithm,
          easyBonus,
          hardInterval,
          lapseInterval,
          startingEase,
          graduatingInterval,
          fsrsWeights,
          fsrsTargetRetention,
          fsrsMaxInterval,
        } = useSettingsStore.getState()

        if (algorithm === 'fsrs') {
          const existing = get().fsrsData[cardId] ?? fsrsInitCard(cardId, USER_ID)
          const fsrsParams = {
            ...DEFAULT_FSRS_PARAMS,
            weights: fsrsWeights,
            targetRetention: fsrsTargetRetention,
            maximumInterval: fsrsMaxInterval,
            requestRetention: fsrsTargetRetention,
          }
          const updated = fsrsSchedule(existing, rating, fsrsParams)

          // Derive a compatible interval for the review log
          const daysDiff =
            (new Date(updated.dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
          const logInterval = Math.max(1, Math.round(daysDiff))

          const log: ReviewLog = {
            id: generateId(),
            sessionId: 'manual',
            cardId,
            userId: USER_ID,
            rating,
            responseMs: 0,
            reviewedAt: new Date().toISOString(),
            scheduledInterval: logInterval,
            ease: updated.difficulty,
          }
          set((s) => ({
            fsrsData: { ...s.fsrsData, [cardId]: updated },
            reviewLogs: [...s.reviewLogs, log],
          }))
        } else {
          const existing = get().srsData[cardId]
          if (!existing) return
          const updated = scheduleCard(existing, rating, {
            easyBonus,
            hardInterval,
            lapseInterval,
            startingEase,
            graduatingInterval,
          })
          const log: ReviewLog = {
            id: generateId(),
            sessionId: 'manual',
            cardId,
            userId: USER_ID,
            rating,
            responseMs: 0,
            reviewedAt: new Date().toISOString(),
            scheduledInterval: updated.interval,
            ease: updated.easeFactor,
          }
          set((s) => ({
            srsData: { ...s.srsData, [cardId]: updated },
            reviewLogs: [...s.reviewLogs, log],
          }))
        }
      },

      // ── Query helpers ────────────────────────────────────────────────────────
      getDueCards: (deckId) => {
        const { cards, srsData, fsrsData } = get()
        const { newCardsPerDay, maxReviewsPerDay, algorithm } = useSettingsStore.getState()
        const pool = deckId ? cards.filter((c) => c.deckId === deckId) : cards

        if (algorithm === 'fsrs') {
          const dueCards = pool.filter((c) => {
            const fs = fsrsData[c.id]
            if (!fs) return true
            return new Date(fs.dueDate) <= new Date()
          })
          const newCards = dueCards.filter((c) => !fsrsData[c.id] || fsrsData[c.id].repetitions === 0)
          const reviewCards = dueCards.filter((c) => (fsrsData[c.id]?.repetitions ?? 0) > 0)
          return [
            ...newCards.slice(0, newCardsPerDay),
            ...reviewCards.slice(0, maxReviewsPerDay),
          ]
        }

        const dueCards = pool.filter((c) => {
          const srs = srsData[c.id]
          return srs ? isDue(srs) : true
        })

        const newCards = dueCards.filter((c) => !srsData[c.id] || srsData[c.id].repetitions === 0)
        const reviewCards = dueCards.filter((c) => (srsData[c.id]?.repetitions ?? 0) > 0)

        return [
          ...newCards.slice(0, newCardsPerDay),
          ...reviewCards.slice(0, maxReviewsPerDay),
        ]
      },

      getDeckCards: (deckId) => {
        return get().cards.filter((c) => c.deckId === deckId)
      },

      getFolderChildren: (folderId) => {
        return get().folders.filter((f) => f.parentId === folderId)
      },

      getDeckMastery: (deckId) => {
        const { cards, srsData } = get()
        const deckCards = cards.filter((c) => c.deckId === deckId)
        if (deckCards.length === 0) return 0
        const total = deckCards.reduce((sum, c) => {
          const srs = srsData[c.id]
          return sum + (srs ? srs.masteryPercent : 0)
        }, 0)
        return Math.round(total / deckCards.length)
      },

      // ── Session ──────────────────────────────────────────────────────────────
      startSession: (deckId) => {
        const session: ReviewSession = {
          id: generateId(),
          userId: USER_ID,
          deckId,
          startedAt: new Date().toISOString(),
          cardsReviewed: 0,
          cardsCorrect: 0,
          cardsIncorrect: 0,
          averageResponseMs: 0,
          mode: 'standard',
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
      name: 'nemos-library',
      skipHydration: true,
    }
  )
)
