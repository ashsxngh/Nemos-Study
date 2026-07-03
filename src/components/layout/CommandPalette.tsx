'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useShallow } from 'zustand/react/shallow'
import {
  Search, LayoutDashboard, Library, BookOpen, FileText,
  BarChart3, Calendar, Settings, Plus, Flame, Star, Moon, Sun,
  Layers, CreditCard, StickyNote, Upload, Clock,
} from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { useLibraryStore } from '@/store/useLibraryStore'
import { useNotesStore } from '@/store/useNotesStore'
import { useRecentStore } from '@/store/useRecentStore'
import { cn, truncate } from '@/lib/utils'

interface CommandItem {
  id: string
  label: string
  description?: string
  icon: React.ReactNode
  group: string
  shortcut?: string[]
  action: () => void
}

export function CommandPalette() {
  const { commandPaletteOpen, closeCommandPalette, theme, setTheme } = useAppStore(
    useShallow((s) => ({
      commandPaletteOpen: s.commandPaletteOpen,
      closeCommandPalette: s.closeCommandPalette,
      theme: s.theme,
      setTheme: s.setTheme,
    }))
  )
  const { decks, cards } = useLibraryStore(useShallow((s) => ({ decks: s.decks, cards: s.cards })))
  const notes = useNotesStore((s) => s.notes)
  const recentDeckIds = useRecentStore((s) => s.recentDeckIds)
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const nav = (href: string) => {
    router.push(href)
    closeCommandPalette()
  }

  const allItems: CommandItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={14} />, group: 'Navigation', action: () => nav('/') },
    { id: 'library', label: 'Library', icon: <Library size={14} />, group: 'Navigation', action: () => nav('/library') },
    { id: 'study', label: 'Study', icon: <BookOpen size={14} />, group: 'Navigation', action: () => nav('/study') },
    { id: 'notes', label: 'Notes', icon: <FileText size={14} />, group: 'Navigation', action: () => nav('/notes') },
    { id: 'stats', label: 'Stats', icon: <BarChart3 size={14} />, group: 'Navigation', action: () => nav('/stats') },
    { id: 'planner', label: 'Planner', icon: <Calendar size={14} />, group: 'Navigation', action: () => nav('/planner') },
    { id: 'settings', label: 'Settings', icon: <Settings size={14} />, group: 'Navigation', action: () => nav('/settings') },
    { id: 'new-deck', label: 'New Deck', icon: <Plus size={14} />, group: 'Create', description: 'Create a new flashcard deck', action: () => nav('/library?action=new-deck') },
    { id: 'new-note', label: 'New Note', icon: <Plus size={14} />, group: 'Create', description: 'Create a new note', action: () => nav('/notes?action=new-note') },
    { id: 'new-folder', label: 'New Folder', icon: <Plus size={14} />, group: 'Create', description: 'Create a new folder', action: () => nav('/library?action=new-folder') },
    { id: 'import', label: 'Import cards', icon: <Upload size={14} />, group: 'Create', description: 'Import cards from CSV, TSV, Markdown or JSON', action: () => nav('/import') },
    { id: 'starred', label: 'Starred items', icon: <Star size={14} />, group: 'Quick access', action: () => nav('/library?filter=starred') },
    { id: 'streak', label: 'View streak', icon: <Flame size={14} />, group: 'Quick access', action: () => nav('/stats#streak') },
    {
      id: 'theme', label: theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode',
      icon: theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />,
      group: 'Settings',
      action: () => { setTheme(theme === 'dark' ? 'light' : 'dark'); closeCommandPalette() }
    },
  ]

  // Recent decks — shown when query is empty
  const recentItems: CommandItem[] = !query.trim()
    ? recentDeckIds
        .map((id) => decks.find((d) => d.id === id))
        .filter((d): d is NonNullable<typeof d> => !!d)
        .map((deck) => ({
          id: `recent-deck-${deck.id}`,
          label: deck.name,
          description: 'Recent deck',
          icon: <Clock size={14} />,
          group: 'Recent',
          action: () => nav(`/study/session?deck=${deck.id}`),
        }))
    : []

  // Dynamic results — only shown when query is non-empty
  const dynamicItems: CommandItem[] = []

  if (query.trim()) {
    const q = query.toLowerCase()

    // Decks — limit 5
    const matchedDecks = decks
      .filter((d) => d.name.toLowerCase().includes(q))
      .slice(0, 5)
    for (const deck of matchedDecks) {
      const cardCount = cards.filter((c) => c.deckId === deck.id).length
      dynamicItems.push({
        id: `deck-${deck.id}`,
        label: deck.name,
        description: `${cardCount} card${cardCount !== 1 ? 's' : ''}`,
        icon: <Layers size={14} />,
        group: 'Decks',
        action: () => nav('/library'),
      })
    }

    // Cards — limit 5
    const matchedCards = cards
      .filter((c) => c.front.toLowerCase().includes(q))
      .slice(0, 5)
    for (const card of matchedCards) {
      const deck = decks.find((d) => d.id === card.deckId)
      dynamicItems.push({
        id: `card-${card.id}`,
        label: truncate(card.front, 50),
        description: deck?.name ?? '',
        icon: <CreditCard size={14} />,
        group: 'Cards',
        action: () => nav(`/study/session?deck=${card.deckId}`),
      })
    }

    // Notes — limit 5
    const matchedNotes = notes
      .filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.content.toLowerCase().includes(q)
      )
      .slice(0, 5)
    for (const note of matchedNotes) {
      dynamicItems.push({
        id: `note-${note.id}`,
        label: note.title || 'Untitled Note',
        description: truncate(note.content.replace(/\n/g, ' '), 60),
        icon: <StickyNote size={14} />,
        group: 'Notes',
        action: () => nav('/notes'),
      })
    }
  }

  const filtered = query
    ? allItems.filter((item) =>
        item.label.toLowerCase().includes(query.toLowerCase()) ||
        item.description?.toLowerCase().includes(query.toLowerCase()) ||
        item.group.toLowerCase().includes(query.toLowerCase())
      )
    : allItems

  const combinedItems = [...recentItems, ...filtered, ...dynamicItems]

  const groups = combinedItems.reduce((acc, item) => {
    if (!acc[item.group]) acc[item.group] = []
    acc[item.group].push(item)
    return acc
  }, {} as Record<string, CommandItem[]>)

  const flatItems = combinedItems

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  useEffect(() => {
    if (commandPaletteOpen) {
      setQuery('')
      setTimeout(() => inputRef.current?.focus(), 10)
    }
  }, [commandPaletteOpen])

  useEffect(() => {
    if (!commandPaletteOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((i) => Math.min(i + 1, flatItems.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        flatItems[activeIndex]?.action()
      } else if (e.key === 'Escape') {
        closeCommandPalette()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [commandPaletteOpen, flatItems, activeIndex, closeCommandPalette])

  if (!commandPaletteOpen) return null

  let itemIndex = 0

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] p-4">
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={closeCommandPalette}
      />
      <div className="relative w-full max-w-lg bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-2xl overflow-hidden animate-scale-in">
        {/* Search input */}
        <div className="flex items-center gap-2.5 px-3.5 h-12 border-b border-[var(--border)]">
          <Search size={15} className="text-[var(--text-muted)] shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search commands, pages, decks..."
            className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
          />
          <kbd className="text-[10px] text-[var(--text-muted)] border border-[var(--border)] rounded px-1 py-0.5">Esc</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-80 overflow-y-auto py-1.5">
          {flatItems.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">
              No results for &ldquo;{query}&rdquo;
            </div>
          ) : (
            Object.entries(groups).map(([group, items]) => (
              <div key={group}>
                <div className="px-3.5 py-1 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-widest">
                  {group}
                </div>
                {items.map((item) => {
                  const currentIndex = itemIndex++
                  return (
                    <button
                      key={item.id}
                      onClick={item.action}
                      onMouseEnter={() => setActiveIndex(currentIndex)}
                      className={cn(
                        'w-full flex items-center gap-2.5 px-3.5 h-9 text-left transition-colors',
                        currentIndex === activeIndex
                          ? 'bg-[var(--bg-hover)]'
                          : 'hover:bg-[var(--bg-hover)]'
                      )}
                    >
                      <span className="text-[var(--text-muted)] shrink-0">{item.icon}</span>
                      <span className="flex-1 text-sm text-[var(--text-primary)]">{item.label}</span>
                      {item.description && (
                        <span className="text-xs text-[var(--text-muted)] truncate max-w-32">{item.description}</span>
                      )}
                      {item.shortcut && (
                        <span className="flex gap-1">
                          {item.shortcut.map((k) => (
                            <kbd key={k} className="text-[10px] text-[var(--text-muted)] border border-[var(--border)] rounded px-1">{k}</kbd>
                          ))}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center gap-4 px-3.5 h-9 border-t border-[var(--border)] text-[10px] text-[var(--text-muted)]">
          <span className="flex items-center gap-1"><kbd className="border border-[var(--border)] rounded px-1">↑↓</kbd> navigate</span>
          <span className="flex items-center gap-1"><kbd className="border border-[var(--border)] rounded px-1">↵</kbd> select</span>
          <span className="flex items-center gap-1"><kbd className="border border-[var(--border)] rounded px-1">Esc</kbd> close</span>
        </div>
      </div>
    </div>
  )
}
