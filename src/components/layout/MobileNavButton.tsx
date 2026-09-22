'use client'

import { Menu } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'

/**
 * Hamburger that opens the off-canvas sidebar. Phone widths only — from `md`
 * up the sidebar is always on screen, so the button would be dead weight.
 *
 * Lives in its own file because the dashboard renders its own hero row instead
 * of the shared `<Header>`, and both need this control.
 */
export function MobileNavButton({ className }: { className?: string }) {
  const setMobileNavOpen = useAppStore((s) => s.setMobileNavOpen)
  return (
    <button
      type="button"
      onClick={() => setMobileNavOpen(true)}
      aria-label="Open navigation"
      className={
        'md:hidden flex items-center justify-center w-9 h-9 shrink-0 rounded-full ' +
        'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors ' +
        (className ?? '')
      }
    >
      <Menu size={20} />
    </button>
  )
}
