'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Theme, ToastData } from '@/lib/types'

interface AppState {
  theme: Theme
  sidebarCollapsed: boolean
  commandPaletteOpen: boolean
  toasts: ToastData[]
  lastOpenDeckId: string | null
  lastOpenNoteId: string | null

  setTheme: (theme: Theme) => void
  toggleSidebar: () => void
  setSidebarCollapsed: (v: boolean) => void
  openCommandPalette: () => void
  closeCommandPalette: () => void
  addToast: (toast: Omit<ToastData, 'id'>) => void
  removeToast: (id: string) => void
  setLastOpenDeck: (id: string | null) => void
  setLastOpenNote: (id: string | null) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      theme: 'dark',
      sidebarCollapsed: false,
      commandPaletteOpen: false,
      toasts: [],
      lastOpenDeckId: null,
      lastOpenNoteId: null,

      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
      openCommandPalette: () => set({ commandPaletteOpen: true }),
      closeCommandPalette: () => set({ commandPaletteOpen: false }),
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
    }),
    {
      name: 'nemos-app',
      partialize: (s) => ({
        theme: s.theme,
        sidebarCollapsed: s.sidebarCollapsed,
        lastOpenDeckId: s.lastOpenDeckId,
        lastOpenNoteId: s.lastOpenNoteId,
      }),
    }
  )
)
