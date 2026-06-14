'use client'

import { useEffect, useRef } from 'react'
import { X, Keyboard } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { cn } from '@/lib/utils'

const SHORTCUTS = [
  {
    group: 'Study Session',
    items: [
      { keys: ['Space'], desc: 'Flip card / Remember' },
      { keys: ['R'], desc: 'Remember' },
      { keys: ['F'], desc: 'Forget' },
      { keys: ['S'], desc: 'Skip card' },
      { keys: ['E'], desc: 'Edit current card' },
      { keys: ['Ctrl', 'Z'], desc: 'Undo last rating' },
      { keys: ['Z'], desc: 'Toggle Zen mode' },
      { keys: ['Esc'], desc: 'Exit Zen mode' },
    ],
  },
  {
    group: 'Card Editor',
    items: [
      { keys: ['Ctrl', 'Enter'], desc: 'Save card' },
      { keys: ['Esc'], desc: 'Cancel / close editor' },
      { keys: ['Ctrl', 'B'], desc: 'Bold' },
      { keys: ['Ctrl', 'I'], desc: 'Italic' },
      { keys: ['Ctrl', 'H'], desc: 'Highlight' },
      { keys: ['Ctrl', '⇧', 'X'], desc: 'Strikethrough' },
      { keys: ['Ctrl', '⇧', 'F'], desc: 'Code block' },
      { keys: ['Ctrl', '⇧', 'M'], desc: 'Inline LaTeX ($…$)' },
      { keys: ['Ctrl', 'O'], desc: 'Insert image' },
      { keys: ['Ctrl', '⇧', 'L'], desc: 'Cloze wrap ({{c1::…}})' },
    ],
  },
  {
    group: 'Library',
    items: [
      { keys: ['N'], desc: 'New card' },
      { keys: ['R'], desc: 'Start reviews' },
      { keys: ['E'], desc: 'Edit selected card' },
      { keys: ['D'], desc: 'Delete selected card' },
      { keys: ['Space'], desc: 'Preview selected card' },
      { keys: ['↑', '↓'], desc: 'Navigate cards' },
      { keys: ['J', 'K'], desc: 'Navigate cards (vim)' },
      { keys: ['Esc'], desc: 'Clear selection' },
    ],
  },
  {
    group: 'Global',
    items: [
      { keys: ['?'], desc: 'Open this shortcuts panel' },
      { keys: ['Ctrl', 'K'], desc: 'Command palette' },
    ],
  },
]

function KeyBadge({ k }: { k: string }) {
  return (
    <kbd className="inline-flex items-center justify-center px-1.5 py-0.5 min-w-[1.4rem] text-[10px] font-mono font-medium rounded bg-[var(--bg-active)] text-[var(--text-secondary)] border border-[var(--border)] leading-none">
      {k}
    </kbd>
  )
}

export function ShortcutsPanel() {
  const open = useAppStore((s) => s.shortcutsPanelOpen)
  const close = useAppStore((s) => s.closeShortcutsPanel)
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, close])

  if (!open) return null

  return (
    <div
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) close() }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      <div className="w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] sticky top-0 bg-[var(--bg-surface)] z-10">
          <div className="flex items-center gap-2.5">
            <Keyboard size={14} className="text-[var(--text-muted)]" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Keyboard Shortcuts</h2>
          </div>
          <button
            onClick={close}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-1 rounded hover:bg-[var(--bg-hover)]"
          >
            <X size={13} />
          </button>
        </div>

        {/* Groups — 2-column grid */}
        <div className="grid grid-cols-2">
          {SHORTCUTS.map((group, gi) => (
            <div
              key={group.group}
              className={cn(
                'px-6 py-5 space-y-2',
                gi % 2 === 0 ? 'border-r border-[var(--border)]' : '',
                gi < 2 ? 'border-b border-[var(--border)]' : '',
              )}
            >
              <p className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest mb-3.5">
                {group.group}
              </p>
              {group.items.map((item) => (
                <div key={item.desc} className="flex items-center justify-between gap-3">
                  <span className="text-xs text-[var(--text-secondary)]">{item.desc}</span>
                  <div className="flex items-center gap-0.5 shrink-0">
                    {item.keys.map((k, i) => (
                      <span key={i} className="flex items-center gap-0.5">
                        <KeyBadge k={k} />
                        {i < item.keys.length - 1 && (
                          <span className="text-[9px] text-[var(--text-muted)]">+</span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="px-6 py-3 border-t border-[var(--border)] flex items-center justify-center gap-1.5 text-[10px] text-[var(--text-muted)]">
          Press <KeyBadge k="?" /> anywhere to toggle · <KeyBadge k="Esc" /> to close
        </div>
      </div>
    </div>
  )
}
