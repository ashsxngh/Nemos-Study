'use client'

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
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
import { useTrashStore } from '@/store/useTrashStore'
import { useExamStore } from '@/store/useExamStore'
import { getExamDeckIds, getPulledForwardCardIds, computeCardUrgencies } from '@/lib/examScheduler'
import { generateId } from '@/lib/utils'

const USER_ID = 'local-user'

interface PendingDeletes {
  folders: string[]
  decks: string[]
  cards: string[]
}

interface LibraryState {
  folders: Folder[]
  decks: Deck[]
  cards: Card[]
  srsData: Record<string, SRSData>
  fsrsData: Record<string, FSRSState>
  reviewLogs: ReviewLog[]
  sessions: ReviewSession[]
  pendingDeletes: PendingDeletes

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
  clearPendingDeletes: () => void

  // Query helpers
  getNewCards: (deckId?: string) => Card[]
  getReviewsDue: (deckId?: string) => Card[]
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
      pendingDeletes: { folders: [], decks: [], cards: [] },

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
        const { folders, decks, cards, srsData, fsrsData, reviewLogs, sessions, pendingDeletes } = get()
        const descendantIds = getAllDescendantFolderIds(folders, id)
        const allFolderIds = [id, ...descendantIds]
        const deckIdsToDelete = decks.filter((d) => d.folderId && allFolderIds.includes(d.folderId)).map((d) => d.id)
        const cardIdsToDelete = cards.filter((c) => deckIdsToDelete.includes(c.deckId)).map((c) => c.id)
        const cardIdSet = new Set(cardIdsToDelete)
        const deckIdSet = new Set(deckIdsToDelete)
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
          reviewLogs: reviewLogs.filter((l) => !cardIdSet.has(l.cardId)),
          sessions: sessions.filter((s) => !deckIdSet.has(s.deckId ?? '')),
          pendingDeletes: {
            folders: [...pendingDeletes.folders, ...allFolderIds],
            decks: [...pendingDeletes.decks, ...deckIdsToDelete],
            cards: [...pendingDeletes.cards, ...cardIdsToDelete],
          },
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
        const { cards, decks, folders, srsData, fsrsData } = get()
        const deck = decks.find((d) => d.id === id)
        const deckCards = cards.filter((c) => c.deckId === id)
        const cardIdsToDelete = deckCards.map((c) => c.id)
        const cardIdSet = new Set(cardIdsToDelete)
        const newSrsData = { ...srsData }
        const newFsrsData = { ...fsrsData }
        cardIdsToDelete.forEach((cid) => {
          delete newSrsData[cid]
          delete newFsrsData[cid]
        })

        // Save to trash before removing
        if (deck) {
          const folderName = deck.folderId
            ? folders.find((f) => f.id === deck.folderId)?.name
            : undefined
          const deckSRS: Record<string, typeof srsData[string]> = {}
          const deckFSRS: Record<string, typeof fsrsData[string]> = {}
          cardIdsToDelete.forEach((cid) => {
            if (srsData[cid]) deckSRS[cid] = srsData[cid]
            if (fsrsData[cid]) deckFSRS[cid] = fsrsData[cid]
          })
          useTrashStore.getState().add({
            id: deck.id,
            type: 'deck',
            deletedAt: new Date().toISOString(),
            name: deck.name,
            parentName: folderName,
            cardCount: deckCards.length,
            deck,
            deckCards,
            deckSRS,
            deckFSRS,
          })
        }

        set((s) => ({
          decks: s.decks.filter((d) => d.id !== id),
          cards: s.cards.filter((c) => c.deckId !== id),
          srsData: newSrsData,
          fsrsData: newFsrsData,
          reviewLogs: s.reviewLogs.filter((l) => !cardIdSet.has(l.cardId)),
          sessions: s.sessions.filter((sess) => sess.deckId !== id),
          pendingDeletes: {
            ...s.pendingDeletes,
            decks: [...s.pendingDeletes.decks, id],
            cards: [...s.pendingDeletes.cards, ...cardIdsToDelete],
          },
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
        const { cards, decks, srsData, fsrsData } = get()
        const card = cards.find((c) => c.id === id)
        const newSrsData = { ...srsData }
        const newFsrsData = { ...fsrsData }
        delete newSrsData[id]
        delete newFsrsData[id]

        // Save to trash before removing
        if (card) {
          const deckName = decks.find((d) => d.id === card.deckId)?.name
          useTrashStore.getState().add({
            id: card.id,
            type: 'card',
            deletedAt: new Date().toISOString(),
            name: card.front,
            parentName: deckName,
            snippet: card.back?.slice(0, 120),
            card,
            cardSRS: srsData[id],
            cardFSRS: fsrsData[id],
          })
        }

        set((s) => ({
          cards: s.cards.filter((c) => c.id !== id),
          srsData: newSrsData,
          fsrsData: newFsrsData,
          pendingDeletes: {
            ...s.pendingDeletes,
            cards: [...s.pendingDeletes.cards, id],
          },
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
          const wasNew = existing.repetitions === 0
          const fsrsParams = {
            ...DEFAULT_FSRS_PARAMS,
            weights: fsrsWeights,
            targetRetention: fsrsTargetRetention,
            maximumInterval: fsrsMaxInterval,
            requestRetention: fsrsTargetRetention,
          }
          const updated = fsrsSchedule(existing, rating, fsrsParams)
          // Cards graduating from new should be reviewable the same day
          if (wasNew && rating >= 3) {
            updated.dueDate = new Date().toISOString()
          }

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
          const wasNew = existing.repetitions === 0
          const updated = scheduleCard(existing, rating, {
            easyBonus,
            hardInterval,
            lapseInterval,
            startingEase,
            graduatingInterval,
          })
          // Cards graduating from new should be reviewable the same day
          if (wasNew && rating >= 3) {
            updated.dueDate = new Date().toISOString()
          }
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

      clearPendingDeletes: () => {
        set({ pendingDeletes: { folders: [], decks: [], cards: [] } })
      },

      // ── Query helpers ────────────────────────────────────────────────────────
      getNewCards: (deckId) => {
        const { cards, fsrsData, srsData } = get()
        const { algorithm, newCardsPerDay } = useSettingsStore.getState()
        const todayStr = new Date().toISOString().slice(0, 10)
        const pool = deckId ? cards.filter((c) => c.deckId === deckId) : cards

        // Count new cards already studied today (repetitions went from 0→1 today)
        const studiedNewToday = pool.filter((c) => {
          if (algorithm === 'fsrs') {
            const fs = fsrsData[c.id]
            return fs && fs.repetitions === 1 && fs.lastReviewedAt?.slice(0, 10) === todayStr
          }
          const srs = srsData[c.id]
          return srs && srs.repetitions === 1 && srs.lastReviewedAt?.slice(0, 10) === todayStr
        }).length

        const remaining = Math.max(0, newCardsPerDay - studiedNewToday)
        if (remaining === 0) return []

        const newCards = pool
          .filter((c) => {
            if (algorithm === 'fsrs') {
              const fs = fsrsData[c.id]
              return !fs || fs.repetitions === 0
            }
            const srs = srsData[c.id]
            return !srs || srs.repetitions === 0
          })
          .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

        return newCards.slice(0, remaining)
      },

      getReviewsDue: (deckId) => {
        const { cards, fsrsData, srsData, decks, folders } = get()
        const { algorithm } = useSettingsStore.getState()
        const pool = deckId ? cards.filter((c) => c.deckId === deckId) : cards
        const now = new Date()

        // Collect IDs of cards pulled forward by exam deadlines
        const pulledForwardIds = new Set<string>()
        const futureExams = useExamStore.getState().exams.filter(
          (e) => new Date(e.date + 'T00:00') > now
        )
        for (const exam of futureExams) {
          const examDeckIds = new Set(getExamDeckIds(exam, decks, folders))
          const linked = pool.filter((c) => examDeckIds.has(c.deckId))
          getPulledForwardCardIds(exam, linked, fsrsData).forEach((id) =>
            pulledForwardIds.add(id)
          )
        }

        return pool.filter((c) => {
          if (pulledForwardIds.has(c.id)) return true
          if (algorithm === 'fsrs') {
            const fs = fsrsData[c.id]
            if (!fs || fs.repetitions === 0) return false
            return new Date(fs.dueDate) <= now
          }
          const srs = srsData[c.id]
          if (!srs || srs.repetitions === 0) return false
          return isDue(srs)
        })
      },

      getDueCards: (deckId) => {
        const newCards = get().getNewCards(deckId)
        const reviews = get().getReviewsDue(deckId)

        // Sort reviews by exam urgency — highest urgency first in inbox
        const { fsrsData, decks, folders } = get()
        const futureExams = useExamStore.getState().exams.filter(
          (e) => new Date(e.date + 'T00:00') > new Date()
        )
        if (futureExams.length > 0) {
          const urgencies = computeCardUrgencies(reviews, fsrsData, futureExams, decks, folders)
          reviews.sort((a, b) => (urgencies.get(b.id) ?? 0) - (urgencies.get(a.id) ?? 0))
        }

        return [...reviews, ...newCards]
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
      storage: createJSONStorage(() => localStorage),
    }
  )
)
