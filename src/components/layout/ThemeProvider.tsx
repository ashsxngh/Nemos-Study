'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store/useAppStore'
import { useKeyboard } from '@/hooks/useKeyboard'
import { CommandPalette } from './CommandPalette'
import { ToastContainer } from '@/components/ui/Toast'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { theme, openCommandPalette, toggleSidebar } = useAppStore(
    useShallow((s) => ({ theme: s.theme, openCommandPalette: s.openCommandPalette, toggleSidebar: s.toggleSidebar }))
  )
  const router = useRouter()
  const [pendingG, setPendingG] = useState(false)
  const pendingGTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }, [theme])

  useKeyboard([
    { key: 'k', meta: true, handler: openCommandPalette },
    // Input-field guarding happens inside useKeyboard's matcher, before
    // preventDefault — plain keypresses in a field are never intercepted.
    { key: '/', handler: () => openCommandPalette() },
    { key: '[', handler: () => toggleSidebar() },
  ])

  // Additional keyboard shortcuts: Cmd+Shift+L, Alt+←, and G-then-X vim jumps
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.key) return
      const target = e.target as HTMLElement | null
      const inInput = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || !!target?.isContentEditable

      // Alt+← — back navigation
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault()
        window.history.back()
        return
      }

      if (!inInput) {
        if (e.key === 'g' || e.key === 'G') {
          setPendingG(true)
          if (pendingGTimer.current) clearTimeout(pendingGTimer.current)
          pendingGTimer.current = setTimeout(() => setPendingG(false), 1000)
        } else if (pendingG) {
          const map: Record<string, string> = { d: '/', l: '/library', n: '/notes', s: '/study', p: '/planner' }
          const dest = map[e.key.toLowerCase()]
          if (dest) {
            e.preventDefault()
            router.push(dest)
            setPendingG(false)
            if (pendingGTimer.current) clearTimeout(pendingGTimer.current)
          }
        }
      }
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [pendingG, router])

  return (
    <>
      {children}
      <CommandPalette />
      <ToastContainer />
    </>
  )
}
