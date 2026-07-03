'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Theme, ToastData } from '@/lib/types'
import { generateId } from '@/lib/utils'

export interface PlannerTask {
  id: string
  label: string
  done: boolean
}

interface AppState {
  theme: Theme
  sidebarCollapsed: boolean
  commandPaletteOpen: boolean
  shortcutsPanelOpen: boolean
  toasts: ToastData[]
  lastOpenDeckId: string | null
  lastOpenNoteId: string | null
  syncing: boolean
  syncError: string | null
  syncOffline: boolean
  manualSync: (() => Promise<void>) | null
  lastBurnoutNudgeAt: string | null
  plannerTasks: PlannerTask[]

  setTheme: (theme: Theme) => void
  toggleSidebar: () => void
  setSidebarCollapsed: (v: boolean) => void
  openCommandPalette: () => void
  closeCommandPalette: () => void
  openShortcutsPanel: () => void
  closeShortcutsPanel: () => void
  addToast: (toast: Omit<ToastData, 'id'>) => void
  removeToast: (id: string) => void
  setLastOpenDeck: (id: string | null) => void
  setLastOpenNote: (id: string | null) => void
  setSyncing: (v: boolean) => void
  setSyncError: (e: string | null) => void
  setSyncOffline: (v: boolean) => void
  setManualSync: (fn: (() => Promise<void>) | null) => void
  setLastBurnoutNudgeAt: (iso: string) => void
  addPlannerTask: (label: string) => void
  togglePlannerTask: (id: string) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      theme: 'dark',
      sidebarCollapsed: false,
      commandPaletteOpen: false,
      shortcutsPanelOpen: false,
      toasts: [],
      lastOpenDeckId: null,
      lastOpenNoteId: null,
      syncing: false,
      syncError: null,
      syncOffline: false,
      manualSync: null,
      lastBurnoutNudgeAt: null,
      plannerTasks: [
        { id: generateId(), label: 'Review flashcards', done: false },
        { id: generateId(), label: 'Read notes', done: false },
      ],

      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
      openCommandPalette: () => set({ commandPaletteOpen: true }),
      closeCommandPalette: () => set({ commandPaletteOpen: false }),
      openShortcutsPanel: () => set({ shortcutsPanelOpen: true }),
      closeShortcutsPanel: () => set({ shortcutsPanelOpen: false }),
      addToast: (toast) =>
        set((s) => ({
          toasts: [
            ...s.toasts,
            { ...toast, id: generateId() },
          ],
        })),
      removeToast: (id) =>
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      setLastOpenDeck: (id) => set({ lastOpenDeckId: id }),
      setLastOpenNote: (id) => set({ lastOpenNoteId: id }),
      setSyncing: (v) => set({ syncing: v }),
      setSyncError: (e) => set({ syncError: e }),
      setSyncOffline: (v) => set({ syncOffline: v }),
      setManualSync: (fn) => set({ manualSync: fn }),
      setLastBurnoutNudgeAt: (iso) => set({ lastBurnoutNudgeAt: iso }),
      addPlannerTask: (label) =>
        set((s) => ({
          plannerTasks: [...s.plannerTasks, { id: generateId(), label, done: false }],
        })),
      togglePlannerTask: (id) =>
        set((s) => ({
          plannerTasks: s.plannerTasks.map((t) => t.id === id ? { ...t, done: !t.done } : t),
        })),
    }),
    {
      name: 'nemos-app',
      partialize: (s) => ({
        theme: s.theme,
        sidebarCollapsed: s.sidebarCollapsed,
        lastOpenDeckId: s.lastOpenDeckId,
        lastOpenNoteId: s.lastOpenNoteId,
        lastBurnoutNudgeAt: s.lastBurnoutNudgeAt,
        plannerTasks: s.plannerTasks,
      }),
    }
  )
)
