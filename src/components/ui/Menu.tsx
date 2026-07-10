'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

export interface MenuItem {
  label: string
  icon?: React.ReactNode
  onClick: () => void
  danger?: boolean
}

/**
 * Shared dismissal behavior for every dropdown/menu/popover in the app:
 * closes on a click outside `containerRef` or on Escape. One place to fix
 * this instead of every menu hand-rolling its own mousedown/keydown pair.
 */
export function useDismiss(
  containerRef: React.RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
) {
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) onClose()
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [containerRef, open, onClose])
}

/** Shared row renderer for a flat MenuItem list — used by anchored dropdowns and the right-click context menu alike. */
export function MenuItemRow({ item, onDone, dense }: { item: MenuItem; onDone: () => void; dense?: boolean }) {
  return (
    <button
      onMouseDown={(e) => {
        e.stopPropagation()
        item.onClick()
        onDone()
      }}
      className={cn(
        'w-full flex items-center gap-2 text-left transition-colors',
        dense ? 'px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)]' : 'px-3 h-8 text-sm hover:bg-[var(--bg-hover)]',
        item.danger ? 'text-[var(--danger)]' : 'text-[var(--text-primary)]'
      )}
    >
      {item.icon}
      {item.label}
    </button>
  )
}

interface AnchoredMenuProps {
  trigger: (props: { onClick: () => void; open: boolean }) => React.ReactNode
  panel: (close: () => void) => React.ReactNode
  panelClassName?: string
  align?: 'left' | 'right'
}

/**
 * Click-to-open dropdown anchored below its trigger — the shared shape
 * behind the account/notifications menus in Header and the per-row "..."
 * menu in LibraryBrowser. `panel` renders the dropdown content, so callers
 * can use either a flat MenuItem list (via MenuItemRow) or fully custom
 * content (Header's rich notification/account panels).
 */
export function AnchoredMenu({ trigger, panel, panelClassName, align = 'right' }: AnchoredMenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(ref, open, close)

  return (
    <div ref={ref} className="relative">
      {trigger({ onClick: () => setOpen((v) => !v), open })}
      {open && (
        <div
          className={cn(
            'absolute top-full mt-1 z-50 bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] shadow-[0_8px_24px_rgba(0,0,0,0.4)] overflow-hidden animate-scale-in',
            align === 'right' ? 'right-0' : 'left-0',
            panelClassName,
          )}
        >
          {panel(close)}
        </div>
      )}
    </div>
  )
}
