'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Exam } from '@/lib/types'
import { generateId } from '@/lib/utils'

const USER_ID = 'local-user'

interface ExamState {
  exams: Exam[]
  pendingDeletedExams: string[]
  addExam: (name: string, subject: string, date: string, priority?: Exam['priority'], deckIds?: string[], folderIds?: string[]) => void
  updateExam: (id: string, updates: Partial<Omit<Exam, 'id' | 'userId' | 'createdAt'>>) => void
  deleteExam: (id: string) => void
  clearPendingDeletedExams: (ids: string[]) => void
  addDeckToExam: (examId: string, deckId: string) => void
  removeDeckFromExam: (examId: string, deckId: string) => void
  addFolderToExam: (examId: string, folderId: string) => void
  removeFolderFromExam: (examId: string, folderId: string) => void
  setTargetRetention: (examId: string, retention: number) => void
  rateExam: (id: string, rating: number, predictedRetention: number) => void
  pruneRefs: (deckIds: string[], folderIds: string[]) => void
}

export const useExamStore = create<ExamState>()(
  persist(
    (set) => ({
      exams: [],
      pendingDeletedExams: [],

      addExam: (name, subject, date, priority = 'medium', deckIds = [], folderIds = []) => {
        const exam: Exam = {
          id: generateId(),
          userId: USER_ID,
          name,
          subject,
          date,
          priority,
          deckIds,
          folderIds,
          targetRetention: 0.90,
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
        set((s) => ({
          exams: s.exams.filter((e) => e.id !== id),
          pendingDeletedExams: [...s.pendingDeletedExams, id],
        }))
      },

      clearPendingDeletedExams: (ids) => {
        const idSet = new Set(ids)
        set((s) => ({
          pendingDeletedExams: s.pendingDeletedExams.filter((id) => !idSet.has(id)),
        }))
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

      addFolderToExam: (examId, folderId) => {
        set((s) => ({
          exams: s.exams.map((e) =>
            e.id === examId && !(e.folderIds ?? []).includes(folderId)
              ? { ...e, folderIds: [...(e.folderIds ?? []), folderId] }
              : e
          ),
        }))
      },

      removeFolderFromExam: (examId, folderId) => {
        set((s) => ({
          exams: s.exams.map((e) =>
            e.id === examId
              ? { ...e, folderIds: (e.folderIds ?? []).filter((f) => f !== folderId) }
              : e
          ),
        }))
      },

      setTargetRetention: (examId, retention) => {
        set((s) => ({
          exams: s.exams.map((e) =>
            e.id === examId ? { ...e, targetRetention: retention } : e
          ),
        }))
      },

      rateExam: (id, rating, predictedRetention) => {
        set((s) => ({
          exams: s.exams.map((e) =>
            e.id === id ? { ...e, rating, predictedRetentionAtExam: predictedRetention } : e
          ),
        }))
      },

      // Called from useLibraryStore's deleteDeck/deleteFolder so a deleted
      // deck/folder's id can't linger in an exam's deckIds/folderIds array
      // (schema.sql has no FK on these — they're plain uuid[] columns, so
      // nothing enforces this at the DB level).
      pruneRefs: (deckIds, folderIds) => {
        if (deckIds.length === 0 && folderIds.length === 0) return
        const deckSet = new Set(deckIds)
        const folderSet = new Set(folderIds)
        set((s) => ({
          exams: s.exams.map((e) => {
            const newDeckIds = e.deckIds.filter((d) => !deckSet.has(d))
            const newFolderIds = (e.folderIds ?? []).filter((f) => !folderSet.has(f))
            if (newDeckIds.length === e.deckIds.length && newFolderIds.length === (e.folderIds ?? []).length) {
              return e
            }
            return { ...e, deckIds: newDeckIds, folderIds: newFolderIds }
          }),
        }))
      },
    }),
    {
      name: 'nemos-exams',
      // useSync explicitly rehydrates this store before the first pull/merge,
      // so it can distinguish "pre-existing local exam" from "pulled from
      // server" — auto-hydration here would race with that and can clobber
      // a freshly-pulled exam list with stale localStorage data.
      skipHydration: true,
    }
  )
)
