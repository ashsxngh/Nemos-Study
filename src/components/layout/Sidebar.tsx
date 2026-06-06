'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
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
  RefreshCw,
  Cloud,
} from 'lucide-react'
import { SettingsPanel } from '@/components/settings/SettingsPanel'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/useAppStore'
import { useLibraryStore } from '@/store/useLibraryStore'
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
  const router = useRouter()
  const { sidebarCollapsed, toggleSidebar, openCommandPalette, syncing, manualSync } = useAppStore()
  const { decks, folders, cards, createDeck, getDueCards, getNewCards, getReviewsDue } = useLibraryStore()
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [showNewDeckForm, setShowNewDeckForm] = useState(false)
  const [newDeckName, setNewDeckName] = useState('')
  const [newDeckFolder, setNewDeckFolder] = useState<string | null>(null)

  const newCards = getNewCards()
  const reviewsDue = getReviewsDue()
  const dueCards = getDueCards()
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

  const handleNewDeckSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    createDeck(newDeckName.trim() || 'New Deck', newDeckFolder)
    setShowNewDeckForm(false)
    setNewDeckName('')
    router.push('/library')
  }

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

        <div className="px-1.5 pt-2 pb-1 space-y-0.5">
          <Tooltip content="Search" shortcut={['Ctrl', 'K']} side="right">
            <button onClick={openCommandPalette} className="flex items-center justify-center w-9 h-9 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)] transition-colors w-full">
              <Search size={14} />
            </button>
          </Tooltip>
        </div>

        <nav className="px-1.5 space-y-0.5">
          {STUDY_ITEMS.map(({ id, label, href, icon: Icon, countKey }) => (
            <Tooltip key={id} content={label} side="right">
              <div className="relative">
                <Link href={href} className={cn('flex items-center justify-center w-9 h-9 rounded-lg transition-colors w-full', isActive(href) ? 'nav-active' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]')}>
                  <Icon size={14} />
                </Link>
                {counts[countKey] > 0 && (
                  <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-[var(--accent)] rounded-full" />
                )}
              </div>
            </Tooltip>
          ))}
          <div className="h-px bg-[var(--border)] mx-1 my-1" />
          {NAV_ITEMS.map(({ id, label, href, icon: Icon }) => (
            <Tooltip key={id} content={label} side="right">
              <Link href={href} className={cn('flex items-center justify-center w-9 h-9 rounded-lg transition-colors w-full', isActive(href) ? 'nav-active' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]')}>
                <Icon size={14} />
              </Link>
            </Tooltip>
          ))}
        </nav>

        <div className="mt-auto px-1.5 pb-2 pt-1 border-t border-[var(--border)] space-y-0.5">
          <Tooltip content={syncing ? 'Saving…' : 'Save to cloud'} side="right">
            <button onClick={() => manualSync?.()} disabled={!manualSync || syncing} className="flex items-center justify-center w-9 h-9 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors w-full disabled:opacity-40">
              <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
            </button>
          </Tooltip>
          <Tooltip content="Settings" side="right">
            <button onClick={() => setSettingsOpen(true)} className="flex items-center justify-center w-9 h-9 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors w-full">
              <Settings size={13} />
            </button>
          </Tooltip>
          <Tooltip content="Trash" side="right">
            <Link href="/trash" className="flex items-center justify-center w-9 h-9 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors w-full">
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

          {!showNewDeckForm ? (
            <button
              onClick={() => setShowNewDeckForm(true)}
              className="flex items-center gap-1.5 h-7 px-1.5 w-full rounded-lg text-xs text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)] transition-colors"
            >
              <Plus size={12} className="shrink-0" />
              New Deck
            </button>
          ) : (
            <form onSubmit={handleNewDeckSubmit} className="px-1.5 py-2 space-y-1.5 animate-fade-in">
              <input
                autoFocus
                value={newDeckName}
                onChange={(e) => setNewDeckName(e.target.value)}
                placeholder="Deck name..."
                className="w-full text-xs bg-[var(--bg-hover)] border border-[var(--accent)] rounded-[var(--radius-sm)] px-2 py-1 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
              />
              <div className="flex gap-1">
                <button type="submit" className="flex-1 text-[10px] font-medium py-1 rounded-[var(--radius-sm)] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity">Create</button>
                <button type="button" onClick={() => setShowNewDeckForm(false)} className="text-[10px] px-2 py-1 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors">Cancel</button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Bottom actions */}
      <div className="px-3 pb-3 pt-2 border-t border-[var(--border)] shrink-0 space-y-0.5">
        {/* Sync status */}
        <button
          onClick={() => manualSync?.()}
          disabled={!manualSync || syncing}
          className="flex items-center gap-2.5 h-8 px-2.5 w-full rounded-lg text-xs transition-colors text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <RefreshCw size={13} className={cn('shrink-0', syncing && 'animate-spin text-[var(--accent)]')} />
          <span className="flex-1 text-left">{syncing ? 'Saving…' : 'Save to cloud'}</span>
          {!syncing && <Cloud size={11} className="text-[var(--text-muted)]" />}
        </button>

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
    </aside>
  )
}
