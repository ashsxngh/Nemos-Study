'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Exam } from '@/lib/types'
import { generateId } from '@/lib/utils'

const USER_ID = 'local-user'

interface ExamState {
  exams: Exam[]
  addExam: (name: string, subject: string, date: string, priority?: Exam['priority'], deckIds?: string[]) => void
  updateExam: (id: string, updates: Partial<Omit<Exam, 'id' | 'userId' | 'createdAt'>>) => void
  deleteExam: (id: string) => void
  addDeckToExam: (examId: string, deckId: string) => void
  removeDeckFromExam: (examId: string, deckId: string) => void
}

export const useExamStore = create<ExamState>()(
  persist(
    (set) => ({
      exams: [],

      addExam: (name, subject, date, priority = 'medium', deckIds = []) => {
        const exam: Exam = {
          id: generateId(),
          userId: USER_ID,
          name,
          subject,
          date,
          priority,
          deckIds,
          createdAt: new Date().toISOString(),
        }
        set((s) => ({ exams: [...s.exams, exam] }))
      },

      updateExam: (id, updates) => {
        set((s) => ({
          exams: s.exams.map((e) => (e.id === id ? { ...e, ...updates } : e)),
        }))
      },

      deleteExam: (id) => {
        set((s) => ({ exams: s.exams.filter((e) => e.id !== id) }))
      },

      addDeckToExam: (examId, deckId) => {
        set((s) => ({
          exams: s.exams.map((e) =>
            e.id === examId && !e.deckIds.includes(deckId)
              ? { ...e, deckIds: [...e.deckIds, deckId] }
              : e
          ),
        }))
      },

      removeDeckFromExam: (examId, deckId) => {
        set((s) => ({
          exams: s.exams.map((e) =>
            e.id === examId
              ? { ...e, deckIds: e.deckIds.filter((d) => d !== deckId) }
              : e
          ),
        }))
      },
    }),
    { name: 'nemos-exams' }
  )
)
