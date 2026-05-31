'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

interface TooltipProps {
  content: string
  children: React.ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  shortcut?: string[]
  className?: string
}

interface Pos { top: number; left: number }

export function Tooltip({ content, children, side = 'top', shortcut, className }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState<Pos>({ top: 0, left: 0 })
  const wrapRef = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  const calcPos = useCallback(() => {
    if (!wrapRef.current) return
    const r = wrapRef.current.getBoundingClientRect()
    const GAP = 8
    const est = { w: 160, h: 28 }
    let top = 0, left = 0

    if (side === 'right') {
      top  = r.top + r.height / 2 - est.h / 2
      left = r.right + GAP
    } else if (side === 'left') {
      top  = r.top + r.height / 2 - est.h / 2
      left = r.left - est.w - GAP
    } else if (side === 'bottom') {
      top  = r.bottom + GAP
      left = r.left + r.width / 2 - est.w / 2
    } else {
      top  = r.top - est.h - GAP
      left = r.left + r.width / 2 - est.w / 2
    }

    // clamp to viewport
    left = Math.max(8, Math.min(left, window.innerWidth  - est.w - 8))
    top  = Math.max(8, Math.min(top,  window.innerHeight - est.h - 8))
    setPos({ top, left })
  }, [side])

  const show = () => {
    calcPos()
    timer.current = setTimeout(() => setVisible(true), 350)
  }

  const hide = () => {
    if (timer.current) clearTimeout(timer.current)
    setVisible(false)
  }

  const tooltip = mounted && visible ? createPortal(
    <div
      className={cn(
        'fixed z-[9999] pointer-events-none animate-scale-in',
        'bg-[var(--text-primary)] text-[var(--bg-base)] text-xs rounded-[var(--radius-sm)] px-2 py-1 whitespace-nowrap',
        'flex items-center gap-1.5 shadow-lg'
      )}
      style={{ top: pos.top, left: pos.left }}
    >
      {content}
      {shortcut && (
        <span className="flex items-center gap-0.5 opacity-50">
          {shortcut.map((k) => (
            <kbd key={k} className="text-[10px] font-mono">{k}</kbd>
          ))}
        </span>
      )}
    </div>,
    document.body
  ) : null

  return (
    <div
      ref={wrapRef}
      className={cn('relative inline-flex', className)}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {children}
      {tooltip}
    </div>
  )
}
