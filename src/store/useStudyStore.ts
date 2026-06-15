'use client'

import { create } from 'zustand'
import type { Card, ReviewLog, SRSData } from '@/lib/types'
import type { FSRSState } from '@/lib/srs'

interface UndoEntry {
  cardId: string
  prevSRS: SRSData
  prevFSRS?: FSRSState
  logId: string
}

interface RedoEntry {
  cardId: string
  newSRS: SRSData
}

interface StudyState {
  sessionId: string | null
  queue: Card[]
  currentIndex: number
  showAnswer: boolean
  logs: Omit<ReviewLog, 'id' | 'sessionId'>[]
  startedAt: Date | null
  mode: 'standard' | 'cram' | 'random' | 'failed-only' | 'new-only' | 'reviews-only'
  undoStack: UndoEntry[]
  redoStack: RedoEntry[]

  startSession: (queue: Card[], mode?: StudyState['mode']) => void
  endSession: () => void
  flipCard: () => void
  nextCard: () => void
  addLog: (log: Omit<ReviewLog, 'id' | 'sessionId'>) => void
  reset: () => void
  pushUndo: (cardId: string, prevSRS: SRSData, logId: string, prevFSRS?: FSRSState) => void
  popUndo: () => UndoEntry | undefined
  pushRedo: (cardId: string, newSRS: SRSData) => void
  popRedo: () => RedoEntry | undefined
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
  redoStack: [],

  startSession: (queue, mode = 'standard') =>
    set({
      queue,
      mode,
      currentIndex: 0,
      showAnswer: false,
      logs: [],
      startedAt: new Date(),
      sessionId: Math.random().toString(36).slice(2),
      undoStack: [],
      redoStack: [],
    }),

  endSession: () => set({ sessionId: null, queue: [], currentIndex: 0 }),

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
      redoStack: [],
    }),

  pushUndo: (cardId, prevSRS, logId, prevFSRS) =>
    set((s) => ({
      undoStack: [...s.undoStack, { cardId, prevSRS, prevFSRS, logId }],
      redoStack: [],
    })),

  popUndo: () => {
    const stack = get().undoStack
    if (stack.length === 0) return undefined
    const entry = stack[stack.length - 1]
    set((s) => ({ undoStack: s.undoStack.slice(0, -1) }))
    return entry
  },

  pushRedo: (cardId, newSRS) =>
    set((s) => ({ redoStack: [...s.redoStack, { cardId, newSRS }] })),

  popRedo: () => {
    const stack = get().redoStack
    if (stack.length === 0) return undefined
    const entry = stack[stack.length - 1]
    set((s) => ({ redoStack: s.redoStack.slice(0, -1) }))
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
