'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, CreditCard, FileText, FolderPlus } from 'lucide-react'
import { useNotesStore } from '@/store/useNotesStore'
import { cn } from '@/lib/utils'

interface MenuItem {
  label: string
  icon: React.ReactNode
  onClick: () => void
}

export function FloatingAdd() {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const { createNote } = useNotesStore()
  const containerRef = useRef<HTMLDivElement>(null)

  const menuItems: MenuItem[] = [
    {
      label: 'New Card',
      icon: <CreditCard size={14} />,
      onClick: () => {
        setOpen(false)
        router.push('/library')
      },
    },
    {
      label: 'New Note',
      icon: <FileText size={14} />,
      onClick: () => {
        setOpen(false)
        createNote()
        router.push('/notes')
      },
    },
    {
      label: 'New Folder',
      icon: <FolderPlus size={14} />,
      onClick: () => {
        setOpen(false)
        router.push('/library?action=new-folder')
      },
    },
  ]

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open])

  return (
    <div ref={containerRef} className="fixed bottom-16 right-4 z-40 flex flex-col items-end gap-2">
      {/* Expanded menu */}
      <div
        className={cn(
          'flex flex-col items-end gap-1.5 transition-all duration-200 origin-bottom-right',
          open ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-95 pointer-events-none'
        )}
      >
        {menuItems.map((item) => (
          <button
            key={item.label}
            onClick={item.onClick}
            className={cn(
              'flex items-center gap-2 h-8 px-3 rounded-full text-sm font-medium',
              'bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)]',
              'shadow-lg hover:bg-[var(--bg-hover)] transition-colors whitespace-nowrap'
            )}
          >
            <span className="text-[var(--text-muted)]">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </div>

      {/* FAB trigger */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'w-11 h-11 rounded-full flex items-center justify-center',
          'bg-[var(--accent)] text-white shadow-lg hover:bg-[var(--accent-hover)]',
          'transition-all duration-200 active:scale-95'
        )}
        aria-label={open ? 'Close quick-add menu' : 'Open quick-add menu'}
      >
        <span
          className={cn(
            'transition-transform duration-200',
            open ? 'rotate-45' : 'rotate-0'
          )}
        >
          <Plus size={20} />
        </span>
      </button>
    </div>
  )
}
