'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

interface ContextMenuItem {
  label: string
  icon?: React.ReactNode
  onClick: () => void
  danger?: boolean
}

interface ContextMenuProps {
  items: ContextMenuItem[]
  children: React.ReactNode
}

interface MenuPosition {
  x: number
  y: number
}

export function ContextMenu({ items, children }: ContextMenuProps) {
  const [position, setPosition] = useState<MenuPosition | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLDivElement>(null)

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    setPosition({ x: e.clientX, y: e.clientY })
  }

  // Adjust position so menu stays in viewport
  useEffect(() => {
    if (!position || !menuRef.current) return
    const menu = menuRef.current
    const rect = menu.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    let { x, y } = position
    if (x + rect.width > vw) x = vw - rect.width - 8
    if (y + rect.height > vh) y = vh - rect.height - 8
    if (x < 8) x = 8
    if (y < 8) y = 8

    // Only update if needed to avoid infinite loop
    if (x !== position.x || y !== position.y) {
      setPosition({ x, y })
    }
  }, [position])

  // Close on outside click
  useEffect(() => {
    if (!position) return
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setPosition(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [position])

  // Close on Escape
  useEffect(() => {
    if (!position) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setPosition(null)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [position])

  const menu = position ? (
    <div
      ref={menuRef}
      style={{ position: 'fixed', left: position.x, top: position.y }}
      className={cn(
        'z-50 min-w-[160px] py-1 rounded-[var(--radius)] border border-[var(--border)]',
        'bg-[var(--bg-surface)] shadow-xl animate-scale-in'
      )}
    >
      {items.map((item, i) => (
        <button
          key={i}
          onClick={() => {
            setPosition(null)
            item.onClick()
          }}
          className={cn(
            'w-full flex items-center gap-2.5 px-3 h-8 text-left text-sm transition-colors',
            item.danger
              ? 'text-[var(--danger)] hover:bg-[var(--danger-subtle)]'
              : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
          )}
        >
          {item.icon && (
            <span className={cn('shrink-0', item.danger ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]')}>
              {item.icon}
            </span>
          )}
          {item.label}
        </button>
      ))}
    </div>
  ) : null

  return (
    <div ref={triggerRef} onContextMenu={handleContextMenu} style={{ display: 'contents' }}>
      {children}
      {typeof document !== 'undefined' && menu ? createPortal(menu, document.body) : null}
    </div>
  )
}
