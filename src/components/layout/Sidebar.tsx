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
      <aside className="flex flex-col h-screen border-r border-[var(--border)] transition-all duration-150 shrink-0 relative w-16 bg-[var(--bg-sidebar)]">
        <button
          onClick={toggleSidebar}
          className="absolute -right-3 top-1/2 -translate-y-1/2 z-10 w-6 h-6 rounded-full border border-[var(--border)] bg-[var(--bg-sidebar)] flex items-center justify-center shadow-sm hover:bg-[var(--bg-hover)] transition-colors"
        >
          <ChevronLeft size={12} className="text-[var(--text-muted)] rotate-180" />
        </button>

        <div className="flex items-center justify-center h-16">
          <div className="w-8 h-8 rounded-lg bg-[var(--accent)] flex items-center justify-center">
            <span className="text-[var(--accent-fg)] text-xs font-bold">N</span>
          </div>
        </div>

        <div className="flex flex-col items-center pt-2 pb-1 gap-1">
          <Tooltip content="Search" shortcut={['Ctrl', 'K']} side="right">
            <button onClick={openCommandPalette} className="flex items-center justify-center w-11 h-11 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)] transition-colors">
              <Search size={18} />
            </button>
          </Tooltip>
        </div>

        <nav className="flex flex-col items-center gap-1">
          {STUDY_ITEMS.map(({ id, label, href, icon: Icon, countKey }) => (
            <Tooltip key={id} content={label} side="right">
              <div className="relative w-11 h-11">
                <Link href={href} className={cn('flex items-center justify-center w-11 h-11 rounded-lg transition-colors', isActive(href) ? 'nav-active' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]')}>
                  <Icon size={18} />
                </Link>
                {counts[countKey] > 0 && (
                  <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-[var(--accent)] rounded-full pointer-events-none" />
                )}
              </div>
            </Tooltip>
          ))}
          <div className="h-px bg-[var(--border)] w-8 my-1.5" />
          {NAV_ITEMS.map(({ id, label, href, icon: Icon }) => (
            <Tooltip key={id} content={label} side="right">
              <Link href={href} className={cn('flex items-center justify-center w-11 h-11 rounded-lg transition-colors', isActive(href) ? 'nav-active' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]')}>
                <Icon size={18} />
              </Link>
            </Tooltip>
          ))}
        </nav>

        <div className="mt-auto flex flex-col items-center pb-3 pt-2 border-t border-[var(--border)] gap-1">
          {showSyncError && (
            <Tooltip content="Sync failed — click to retry" side="right">
              <button onClick={() => manualSync?.()} className="flex items-center justify-center w-11 h-11 rounded-lg hover:bg-[var(--danger-subtle)] transition-colors">
                <WifiOff size={17} className="text-[var(--danger)]" />
              </button>
            </Tooltip>
          )}
          <Tooltip content="Settings" side="right">
            <button onClick={() => setSettingsOpen(true)} className="flex items-center justify-center w-11 h-11 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors">
              <Settings size={17} />
            </button>
          </Tooltip>
          <Tooltip content="Trash" side="right">
            <Link href="/trash" className="flex items-center justify-center w-11 h-11 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors">
              <Trash2 size={17} />
            </Link>
          </Tooltip>
        </div>
        <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </aside>
    )
  }

  return (
    <aside className="flex flex-col h-screen border-r border-[var(--border)] transition-all duration-150 shrink-0 relative w-[260px] bg-[var(--bg-sidebar)]">
      {/* Edge collapse toggle */}
      <button
        onClick={toggleSidebar}
        className="absolute -right-3 top-1/2 -translate-y-1/2 z-10 w-6 h-6 rounded-full border border-[var(--border)] bg-[var(--bg-sidebar)] flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity group-hover:opacity-100 shadow-sm hover:bg-[var(--bg-hover)]"
        title="Collapse sidebar"
      >
        <ChevronLeft size={12} className="text-[var(--text-muted)]" />
      </button>

      {/* Logo / Brand — Stitch: big wordmark + mono tagline, no box */}
      <div className="px-6 pt-7 pb-6 shrink-0">
        <p className="text-2xl font-semibold text-[var(--text-primary)] tracking-tight leading-tight">Nemos Study</p>
        <p className="meta-label-sm uppercase tracking-[0.15em] text-[var(--text-muted)] mt-1">Deep Focus Learning</p>
      </div>

      {/* Search */}
      <div className="px-4 pb-4 shrink-0">
        <Tooltip content="Search" shortcut={['Ctrl', 'K']} side="right">
          <button
            onClick={openCommandPalette}
            className="w-full flex items-center gap-2.5 h-10 rounded-[var(--radius-lg)] text-[var(--text-muted)] text-sm bg-[var(--bg-inset)] border border-transparent hover:border-[var(--border)] hover:bg-[var(--bg-raised)] transition-colors px-4"
          >
            <Search size={16} className="shrink-0" />
            <span className="flex-1 text-left">Search</span>
            <kbd className="text-[11px] opacity-40 font-mono">Ctrl K</kbd>
          </button>
        </Tooltip>
      </div>

      {/* Main nav — Stitch: roomy rows, 15px labels, 20px icons */}
      <div className="px-4 pb-2 shrink-0">
        <nav className="space-y-1">
          {NAV_ITEMS.map(({ id, label, href, icon: Icon }) => (
            <Link
              key={id}
              href={href}
              className={cn(
                'flex items-center gap-3 px-4 py-2.5 rounded-lg text-[15px] transition-colors',
                'hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
                isActive(href) ? 'nav-active font-semibold' : 'text-[var(--text-secondary)] font-medium'
              )}
            >
              <Icon size={20} className="shrink-0" strokeWidth={1.75} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
      </div>

      {/* Study section */}
      <div className="px-4 pb-2 shrink-0">
        <p className="meta-label text-[var(--text-muted)] opacity-70 px-4 mt-3 mb-2">Study</p>
        <nav className="space-y-1">
          {STUDY_ITEMS.map(({ id, label, href, icon: Icon, countKey }) => (
            <Link
              key={id}
              href={href}
              className={cn(
                'flex items-center gap-3 px-4 py-2.5 rounded-lg text-[15px] transition-colors w-full',
                'hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
                isActive(href) ? 'nav-active font-semibold' : 'text-[var(--text-secondary)] font-medium'
              )}
            >
              <Icon size={20} className="shrink-0" strokeWidth={1.75} />
              <span className="flex-1">{label}</span>
              {counts[countKey] > 0 && (
                <span className={cn(
                  'font-mono text-[11px] font-bold rounded-full px-2 py-0.5 leading-none min-w-[22px] text-center',
                  countKey === 'inbox'   ? 'bg-[var(--accent)] text-[var(--accent-fg)]' :
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

      {/* Decks tree */}
      <div className="flex-1 overflow-y-auto px-4 min-h-0">
        <p className="meta-label text-[var(--text-muted)] opacity-70 px-4 mt-3 mb-2">Decks</p>
        <div className="space-y-0.5">
          {rootFolders.map((folder) => {
            const isExpanded = expandedFolders.has(folder.id)
            const childDecks = decks.filter((d) => d.folderId === folder.id && !d.isArchived)
            return (
              <div key={folder.id}>
                <button
                  onClick={() => toggleFolder(folder.id)}
                  className="w-full flex items-center gap-2 h-9 px-3 rounded-lg text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <ChevronRight size={13} className={cn('shrink-0 text-[var(--text-muted)] transition-transform duration-150', isExpanded && 'rotate-90')} />
                  <BookOpen size={15} className="shrink-0" />
                  <span className="flex-1 text-left truncate">{folder.name}</span>
                </button>
                {isExpanded && childDecks.map((deck) => (
                  <Link
                    key={deck.id}
                    href="/library"
                    className="flex items-center gap-2 h-9 pl-10 pr-3 rounded-lg text-sm text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)] transition-colors"
                  >
                    <span className="flex-1 truncate">{deck.name}</span>
                    <span className="font-mono text-[11px] text-[var(--text-muted)] shrink-0">{deckCardCount(deck.id)}</span>
                  </Link>
                ))}
              </div>
            )
          })}

          {rootDecks.map((deck) => (
            <Link
              key={deck.id}
              href="/library"
              className="flex items-center gap-2 h-9 px-3 rounded-lg text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
            >
              <ChevronRight size={13} className="shrink-0 text-transparent" />
              <BookOpen size={15} className="shrink-0" />
              <span className="flex-1 truncate">{deck.name}</span>
              <span className="font-mono text-[11px] text-[var(--text-muted)] shrink-0">{deckCardCount(deck.id)}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* Bottom actions — Stitch: big periwinkle New Deck above mono utility rows */}
      <div className="px-4 pb-5 pt-4 border-t border-[var(--border)] shrink-0 space-y-1">
        <button
          onClick={() => setShowNewDeckForm(true)}
          className="w-full mb-3 py-3 bg-[var(--accent)] text-[var(--accent-fg)] font-bold text-[15px] rounded-lg flex items-center justify-center gap-2 hover:bg-[var(--accent-hover)] active:scale-95 transition-all duration-100"
        >
          <Plus size={18} className="shrink-0" />
          New Deck
        </button>

        {/* Sync status — only visible on error, hidden during active study sessions */}
        {showSyncError && (
          <button
            onClick={() => manualSync?.()}
            className="flex items-center gap-3 px-4 py-2 w-full rounded-lg transition-colors text-[var(--danger)] hover:bg-[var(--danger-subtle)]"
          >
            <WifiOff size={17} className="shrink-0" />
            <span className="flex-1 text-left meta-label-sm">Sync failed — retry</span>
          </button>
        )}

        <button
          onClick={() => setSettingsOpen(true)}
          className="flex items-center gap-3 px-4 py-2 w-full rounded-lg transition-colors text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          <Settings size={17} className="shrink-0" strokeWidth={1.75} />
          <span className="meta-label-sm">Settings</span>
        </button>

        <Link
          href="/trash"
          className="flex items-center gap-3 px-4 py-2 rounded-lg transition-colors text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          <Trash2 size={17} className="shrink-0" strokeWidth={1.75} />
          <span className="meta-label-sm">Trash</span>
        </Link>

        <button
          onClick={toggleSidebar}
          className="flex items-center gap-3 px-4 py-2 w-full rounded-lg transition-colors text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]"
        >
          <ChevronLeft size={17} className="shrink-0" strokeWidth={1.75} />
          <span className="meta-label-sm">Collapse</span>
        </button>
      </div>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <CreateDeckDialog open={showNewDeckForm} onClose={() => setShowNewDeckForm(false)} />
    </aside>
  )
}
