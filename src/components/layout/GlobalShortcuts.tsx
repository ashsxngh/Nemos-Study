'use client'

import { useEffect } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { ShortcutsPanel } from './ShortcutsPanel'

export function GlobalShortcuts() {
  const openShortcutsPanel = useAppStore((s) => s.openShortcutsPanel)
  const openCommandPalette = useAppStore((s) => s.openCommandPalette)
  const shortcutsPanelOpen = useAppStore((s) => s.shortcutsPanelOpen)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (shortcutsPanelOpen) return
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return

      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        openShortcutsPanel()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        openCommandPalette()
        return
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [openShortcutsPanel, openCommandPalette, shortcutsPanelOpen])

  return <ShortcutsPanel />
}
