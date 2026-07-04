'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useShallow } from 'zustand/react/shallow'
import {
  LayoutDashboard,
  Library,
  FileText,
  BarChart3,
  Calendar,
  ChevronRight,
  ChevronLeft,
  Search,
  Settings,
  Trash2,
  Plus,
  ChevronDown,
  BookOpen,
  Sparkles,
  RotateCcw,
  Inbox,
  WifiOff,
} from 'lucide-react'
import { SettingsPanel } from '@/components/settings/SettingsPanel'
import { CreateDeckDialog } from '@/components/library/CreateDeckDialog'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/useAppStore'
import { useLibraryStore } from '@/store/useLibraryStore'
import { useHistoryStore } from '@/store/useHistoryStore'
import { useSettingsStore } from '@/store/useSettingsStore'
import { Tooltip } from '@/components/ui/Tooltip'

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', href: '/',        icon: LayoutDashboard },
  { id: 'library',   label: 'Library',   href: '/library', icon: Library },
  { id: 'notes',     label: 'Notes',     href: '/notes',   icon: FileText },
  { id: 'stats',     label: 'Stats',     href: '/stats',   icon: BarChart3 },
  { id: 'planner',   label: 'Planner',   href: '/planner', icon: Calendar },
]

const STUDY_ITEMS = [
  { id: 'inbox',     label: 'Inbox',     href: '/study/inbox',    icon: Inbox,     countKey: 'inbox' as const },
  { id: 'new',       label: 'New Cards', href: '/study/new',      icon: Sparkles,  countKey: 'new' as const },
  { id: 'reviews',   label: 'Reviews',   href: '/study/reviews',  icon: RotateCcw, countKey: 'reviews' as const },
]

export function Sidebar() {
  const pathname = usePathname()
  const { sidebarCollapsed, toggleSidebar, openCommandPalette, syncError, manualSync } = useAppStore(
    useShallow((s) => ({
      sidebarCollapsed: s.sidebarCollapsed,
      toggleSidebar: s.toggleSidebar,
      openCommandPalette: s.openCommandPalette,
      syncError: s.syncError,
      manualSync: s.manualSync,
    }))
  )
  const { decks, folders, cards, fsrsData, getDueCards, getNewCards, getReviewsDue } = useLibraryStore(
    useShallow((s) => ({
      decks: s.decks,
      folders: s.folders,
      cards: s.cards,
      fsrsData: s.fsrsData,
      getDueCards: s.getDueCards,
      getNewCards: s.getNewCards,
      getReviewsDue: s.getReviewsDue,
    }))
  )
  const reviewLogs = useHistoryStore((s) => s.reviewLogs)
  const newCardsPerDay = useSettingsStore((s) => s.newCardsPerDay)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [showNewDeckForm, setShowNewDeckForm] = useState(false)

  // getNewCards/getReviewsDue/getDueCards are the most expensive queries in
  // the app (O(cards) scans with sorting/interleaving) — memoized so a
  // rating echo during a study session (which changes fsrsData but
  // not cards/decks/folders) only recomputes what actually changed.
  const newCards = useMemo(
    () => getNewCards(),
    [cards, decks, fsrsData, reviewLogs, newCardsPerDay, getNewCards]
  )
  const reviewsDue = useMemo(
    () => getReviewsDue(),
    [cards, decks, folders, fsrsData, getReviewsDue]
  )
  const dueCards = useMemo(
    () => getDueCards(),
    [cards, decks, folders, fsrsData, reviewLogs, newCardsPerDay, getDueCards]
  )

  // Don't surface sync errors during an active study session — they're a
  // distraction mid-review and the icon will still show as soon as the user leaves.
  const showSyncError = syncError && !pathname.startsWith('/study/session')
  const inboxCount = dueCards.length

  const counts = { inbox: inboxCount, new: newCards.length, reviews: reviewsDue.length }

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href.split('?')[0])

  const toggleFolder = (id: string) =>
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const rootFolders = folders.filter((f) => !f.parentId && !f.isArchived)
  const rootDecks   = decks.filter((d) => !d.folderId && !d.isArchived)

  const deckCardCount = (deckId: string) => cards.filter((c) => c.deckId === deckId).length

  if (sidebarCollapsed) {
    return (
      <aside className="flex flex-col h-screen border-r border-[var(--border)] transition-all duration-150 shrink-0 relative w-12 bg-[var(--bg-surface)]">
        <button
          onClick={toggleSidebar}
          className="absolute -right-3 top-1/2 -translate-y-1/2 z-10 w-6 h-6 rounded-full border border-[var(--border)] bg-[var(--bg-surface)] flex items-center justify-center shadow-sm hover:bg-[var(--bg-hover)] transition-colors"
        >
          <ChevronLeft size={12} className="text-[var(--text-muted)] rotate-180" />
        </button>

        <div className="flex items-center justify-center h-12 border-b border-[var(--border)]">
          <div className="w-6 h-6 rounded-md bg-[var(--accent)] flex items-center justify-center">
            <span className="text-white text-[10px] font-bold">N</span>
          </div>
        </div>

        <div className="flex flex-col items-center pt-2 pb-1 gap-0.5">
          <Tooltip content="Search" shortcut={['Ctrl', 'K']} side="right">
            <button onClick={openCommandPalette} className="flex items-center justify-center w-9 h-9 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)] transition-colors">
              <Search size={14} />
            </button>
          </Tooltip>
        </div>

        <nav className="flex flex-col items-center gap-0.5">
          {STUDY_ITEMS.map(({ id, label, href, icon: Icon, countKey }) => (
            <Tooltip key={id} content={label} side="right">
              <div className="relative w-9 h-9">
                <Link href={href} className={cn('flex items-center justify-center w-9 h-9 rounded-lg transition-colors', isActive(href) ? 'nav-active' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]')}>
                  <Icon size={14} />
                </Link>
                {counts[countKey] > 0 && (
                  <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-[var(--accent)] rounded-full pointer-events-none" />
                )}
              </div>
            </Tooltip>
          ))}
          <div className="h-px bg-[var(--border)] w-6 my-1" />
          {NAV_ITEMS.map(({ id, label, href, icon: Icon }) => (
            <Tooltip key={id} content={label} side="right">
              <Link href={href} className={cn('flex items-center justify-center w-9 h-9 rounded-lg transition-colors', isActive(href) ? 'nav-active' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]')}>
                <Icon size={14} />
              </Link>
            </Tooltip>
          ))}
        </nav>

        <div className="mt-auto flex flex-col items-center pb-2 pt-1 border-t border-[var(--border)] gap-0.5">
          {showSyncError && (
            <Tooltip content="Sync failed — click to retry" side="right">
              <button onClick={() => manualSync?.()} className="flex items-center justify-center w-9 h-9 rounded-lg hover:bg-[var(--danger-subtle)] transition-colors">
                <WifiOff size={13} className="text-[var(--danger)]" />
              </button>
            </Tooltip>
          )}
          <Tooltip content="Settings" side="right">
            <button onClick={() => setSettingsOpen(true)} className="flex items-center justify-center w-9 h-9 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors">
              <Settings size={13} />
            </button>
          </Tooltip>
          <Tooltip content="Trash" side="right">
            <Link href="/trash" className="flex items-center justify-center w-9 h-9 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors">
              <Trash2 size={13} />
            </Link>
          </Tooltip>
        </div>
        <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </aside>
    )
  }

  return (
    <aside className="flex flex-col h-screen border-r border-[var(--border)] transition-all duration-150 shrink-0 relative w-[240px] bg-[var(--bg-surface)]">
      {/* Edge collapse toggle */}
      <button
        onClick={toggleSidebar}
        className="absolute -right-3 top-1/2 -translate-y-1/2 z-10 w-6 h-6 rounded-full border border-[var(--border)] bg-[var(--bg-surface)] flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity group-hover:opacity-100 shadow-sm hover:bg-[var(--bg-hover)]"
        title="Collapse sidebar"
      >
        <ChevronLeft size={12} className="text-[var(--text-muted)]" />
      </button>

      {/* Logo / Brand */}
      <div className="flex items-center gap-3 h-14 px-4 border-b border-[var(--border)] shrink-0">
        <div className="w-7 h-7 rounded-lg bg-[var(--accent)] flex items-center justify-center shrink-0">
          <span className="text-white text-xs font-bold tracking-tight">N</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-[var(--text-primary)] tracking-tight">Nemos Study</p>
          <p className="text-[10px] text-[var(--text-muted)] leading-none mt-0.5">Deep Focus Learning</p>
        </div>
        <ChevronDown size={12} className="text-[var(--text-muted)] shrink-0" />
      </div>

      {/* Search */}
      <div className="px-3 pt-3 pb-2 shrink-0">
        <Tooltip content="Search" shortcut={['Ctrl', 'K']} side="right">
          <button
            onClick={openCommandPalette}
            className="w-full flex items-center gap-2 h-8 rounded-lg text-[var(--text-muted)] text-xs bg-[var(--bg-hover)] hover:bg-[var(--bg-active)] transition-colors px-3"
          >
            <Search size={12} className="shrink-0" />
            <span className="flex-1 text-left">Search</span>
            <kbd className="text-[10px] opacity-40 font-mono">Ctrl K</kbd>
          </button>
        </Tooltip>
      </div>

      {/* Study section */}
      <div className="px-3 pb-1 shrink-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)] px-1 mb-1.5">Study</p>
        <nav className="space-y-0.5">
          {STUDY_ITEMS.map(({ id, label, href, icon: Icon, countKey }) => (
            <Link
              key={id}
              href={href}
              className={cn(
                'flex items-center gap-2.5 h-8 px-2.5 rounded-lg text-xs font-medium transition-colors w-full',
                'hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
                isActive(href) ? 'nav-active' : 'text-[var(--text-secondary)]'
              )}
            >
              <Icon size={14} className="shrink-0" />
              <span className="flex-1">{label}</span>
              {counts[countKey] > 0 && (
                <span className={cn(
                  'text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none min-w-[18px] text-center',
                  countKey === 'inbox'   ? 'bg-[var(--accent)] text-white' :
                  countKey === 'new'     ? 'bg-[var(--accent-subtle)] text-[var(--accent)]' :
                                           'bg-[var(--success-subtle)] text-[var(--success)]'
                )}>
                  {counts[countKey] > 99 ? '99+' : counts[countKey]}
                </span>
              )}
            </Link>
          ))}
        </nav>
      </div>

      <div className="mx-3 border-t border-[var(--border)] mb-1" />

      {/* Main nav */}
      <div className="px-3 pb-1 shrink-0">
        <nav className="space-y-0.5">
          {NAV_ITEMS.map(({ id, label, href, icon: Icon }) => (
            <Link
              key={id}
              href={href}
              className={cn(
                'flex items-center gap-2.5 h-8 px-2.5 rounded-lg text-xs transition-colors',
                'hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
                isActive(href) ? 'nav-active font-medium' : 'text-[var(--text-secondary)]'
              )}
            >
              <Icon size={14} className="shrink-0" />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
      </div>

      <div className="mx-3 border-t border-[var(--border)] mb-1" />

      {/* Decks tree */}
      <div className="flex-1 overflow-y-auto px-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)] px-1 mb-1.5">Decks</p>
        <div className="space-y-0.5">
          {rootFolders.map((folder) => {
            const isExpanded = expandedFolders.has(folder.id)
            const childDecks = decks.filter((d) => d.folderId === folder.id && !d.isArchived)
            return (
              <div key={folder.id}>
                <button
                  onClick={() => toggleFolder(folder.id)}
                  className="w-full flex items-center gap-1.5 h-7 px-1.5 rounded-lg text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <ChevronRight size={11} className={cn('shrink-0 text-[var(--text-muted)] transition-transform duration-150', isExpanded && 'rotate-90')} />
                  <BookOpen size={12} className="shrink-0" />
                  <span className="flex-1 text-left truncate">{folder.name}</span>
                </button>
                {isExpanded && childDecks.map((deck) => (
                  <Link
                    key={deck.id}
                    href="/library"
                    className="flex items-center gap-1.5 h-7 pl-7 pr-1.5 rounded-lg text-xs text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)] transition-colors"
                  >
                    <span className="flex-1 truncate">{deck.name}</span>
                    <span className="text-[10px] text-[var(--text-muted)] shrink-0">{deckCardCount(deck.id)}</span>
                  </Link>
                ))}
              </div>
            )
          })}

          {rootDecks.map((deck) => (
            <Link
              key={deck.id}
              href="/library"
              className="flex items-center gap-1.5 h-7 px-1.5 rounded-lg text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
            >
              <ChevronRight size={11} className="shrink-0 text-transparent" />
              <BookOpen size={12} className="shrink-0" />
              <span className="flex-1 truncate">{deck.name}</span>
              <span className="text-[10px] text-[var(--text-muted)] shrink-0">{deckCardCount(deck.id)}</span>
            </Link>
          ))}

          <button
            onClick={() => setShowNewDeckForm(true)}
            className="flex items-center gap-1.5 h-7 px-1.5 w-full rounded-lg text-xs text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)] transition-colors"
          >
            <Plus size={12} className="shrink-0" />
            New Deck
          </button>
        </div>
      </div>

      {/* Bottom actions */}
      <div className="px-3 pb-3 pt-2 border-t border-[var(--border)] shrink-0 space-y-0.5">
        {/* Sync status — only visible on error, hidden during active study sessions */}
        {showSyncError && (
          <button
            onClick={() => manualSync?.()}
            className="flex items-center gap-2.5 h-8 px-2.5 w-full rounded-lg text-xs transition-colors text-[var(--danger)] hover:bg-[var(--danger-subtle)]"
          >
            <WifiOff size={13} className="shrink-0" />
            <span className="flex-1 text-left">Sync failed — retry</span>
          </button>
        )}

        <button
          onClick={() => setSettingsOpen(true)}
          className="flex items-center gap-2.5 h-8 px-2.5 w-full rounded-lg text-xs transition-colors text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]"
        >
          <Settings size={13} className="shrink-0" />
          Settings
        </button>

        <Link
          href="/trash"
          className="flex items-center gap-2.5 h-8 px-2.5 rounded-lg text-xs transition-colors text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]"
        >
          <Trash2 size={13} className="shrink-0" />
          Trash
        </Link>

        <button
          onClick={toggleSidebar}
          className="flex items-center gap-2.5 h-8 px-2.5 w-full rounded-lg text-xs transition-colors text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]"
        >
          <ChevronLeft size={13} className="shrink-0" />
          Collapse
        </button>
      </div>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <CreateDeckDialog open={showNewDeckForm} onClose={() => setShowNewDeckForm(false)} />
    </aside>
  )
}
