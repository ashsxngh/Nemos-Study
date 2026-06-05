'use client'

import { useEffect } from 'react'

type KeyHandler = (e: KeyboardEvent) => void

interface Shortcut {
  key: string
  meta?: boolean
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  handler: KeyHandler
}

export function useKeyboard(shortcuts: Shortcut[]) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      for (const shortcut of shortcuts) {
        const metaMatch = shortcut.meta ? (e.metaKey || e.ctrlKey) : true
        const ctrlMatch = shortcut.ctrl ? e.ctrlKey : true
        const shiftMatch = shortcut.shift ? e.shiftKey : !shortcut.shift || e.shiftKey
        const altMatch = shortcut.alt ? e.altKey : true
        if (!shortcut.key) continue
        const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase()

        if (keyMatch && metaMatch && ctrlMatch && altMatch) {
          e.preventDefault()
          shortcut.handler(e)
          break
        }
      }
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [shortcuts])
}
