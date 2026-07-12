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
      // e.key is undefined/empty on some real-world events: IME composition,
      // certain Android/Samsung keyboards, and browser-extension-synthesized
      // keydown events all omit it. Nothing below can match without it.
      if (!e.key) return

      // Must be checked before preventDefault: a plain keypress ('/', '[' …)
      // inside a field is the user typing that character — swallowing it here
      // would block it from ever reaching the input. Modifier combos
      // (Ctrl+K etc.) are still allowed through while typing.
      const target = e.target as HTMLElement | null
      const inEditable =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || !!target?.isContentEditable
      const plainKeypress = !e.ctrlKey && !e.metaKey && !e.altKey

      for (const shortcut of shortcuts) {
        const metaMatch = shortcut.meta ? (e.metaKey || e.ctrlKey) : true
        const ctrlMatch = shortcut.ctrl ? e.ctrlKey : true
        const shiftMatch = shortcut.shift ? e.shiftKey : true
        const altMatch = shortcut.alt ? e.altKey : true
        if (!shortcut.key) continue
        const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase()

        if (keyMatch && metaMatch && ctrlMatch && shiftMatch && altMatch) {
          if (inEditable && plainKeypress) continue
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
