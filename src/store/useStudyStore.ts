'use client'

import { create } from 'zustand'
import type { Card, ReviewLog } from '@/lib/types'
import type { FSRSState } from '@/lib/srs'
import { generateId } from '@/lib/utils'

interface UndoEntry {
  cardId: string
  prevFSRS: FSRSState
  logId: string
  isNew: boolean
  rating: number
}

interface StudyState {
  sessionId: string | null
  queue: Card[]
  currentIndex: number
  showAnswer: boolean
  logs: Omit<ReviewLog, 'id' | 'sessionId'>[]
  startedAt: Date | null
  mode: 'standard' | 'cram' | 'random' | 'failed-only' | 'new-only' | 'reviews-only' | 'deck-all' | 'deck-reviews' | 'deck-new' | 'deck-both'
  undoStack: UndoEntry[]

  startSession: (queue: Card[], mode?: StudyState['mode']) => void
  endSession: () => void
  reorderQueue: (queue: Card[], currentIndex: number) => void
  flipCard: () => void
  nextCard: () => void
  addLog: (log: Omit<ReviewLog, 'id' | 'sessionId'>) => void
  reset: () => void
  pushUndo: (cardId: string, prevFSRS: FSRSState, logId: string, isNew: boolean, rating: number) => void
  popUndo: () => UndoEntry | undefined
  decrementIndex: () => void
  requeueCurrentCard: () => void
  removeCurrentCard: () => void
}

export const useStudyStore = create<StudyState>((set, get) => ({
  sessionId: null,
  queue: [],
  currentIndex: 0,
  showAnswer: false,
  logs: [],
  startedAt: null,
  mode: 'standard',
  undoStack: [],

  startSession: (queue, mode = 'standard') =>
    set({
      queue,
      mode,
      currentIndex: 0,
      showAnswer: false,
      logs: [],
      startedAt: new Date(),
      sessionId: generateId(),
      undoStack: [],
    }),

  endSession: () => set({ sessionId: null, queue: [], currentIndex: 0 }),

  // Reorders/truncates the queue (back navigation, shuffle) without touching
  // logs, undoStack, redoStack, or sessionId — those must survive across re-orders.
  reorderQueue: (queue, currentIndex) => set({ queue, currentIndex, showAnswer: false }),

  flipCard: () => set((s) => ({ showAnswer: !s.showAnswer })),

  nextCard: () =>
    set((s) => ({
      currentIndex: s.currentIndex + 1,
      showAnswer: false,
    })),

  addLog: (log) => set((s) => ({ logs: [...s.logs, log] })),

  reset: () =>
    set({
      sessionId: null,
      queue: [],
      currentIndex: 0,
      showAnswer: false,
      logs: [],
      startedAt: null,
      undoStack: [],
    }),

  pushUndo: (cardId, prevFSRS, logId, isNew, rating) =>
    set((s) => ({
      undoStack: [...s.undoStack, { cardId, prevFSRS, logId, isNew, rating }],
    })),

  popUndo: () => {
    const stack = get().undoStack
    if (stack.length === 0) return undefined
    const entry = stack[stack.length - 1]
    set((s) => ({ undoStack: s.undoStack.slice(0, -1) }))
    return entry
  },

  decrementIndex: () =>
    set((s) => ({
      currentIndex: Math.max(0, s.currentIndex - 1),
      showAnswer: false,
    })),

  requeueCurrentCard: () =>
    set((s) => {
      const card = s.queue[s.currentIndex]
      if (!card) return s
      return {
        queue: [...s.queue, card],
        currentIndex: s.currentIndex + 1,
        showAnswer: false,
      }
    }),

  removeCurrentCard: () =>
    set((s) => {
      const newQueue = [...s.queue]
      newQueue.splice(s.currentIndex, 1)
      return { queue: newQueue, showAnswer: false }
    }),
}))
