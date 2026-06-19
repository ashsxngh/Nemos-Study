'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Theme, ToastData } from '@/lib/types'

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
            { ...toast, id: Math.random().toString(36).slice(2) },
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
    }),
    {
      name: 'nemos-app',
      partialize: (s) => ({
        theme: s.theme,
        sidebarCollapsed: s.sidebarCollapsed,
        lastOpenDeckId: s.lastOpenDeckId,
        lastOpenNoteId: s.lastOpenNoteId,
        lastBurnoutNudgeAt: s.lastBurnoutNudgeAt,
      }),
    }
  )
)
