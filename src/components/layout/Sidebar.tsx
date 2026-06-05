'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard,
  Inbox,
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
  User,
  ChevronDown,
  BookOpen,
  Sparkles,
  RotateCcw,
} from 'lucide-react'
import { SettingsPanel } from '@/components/settings/SettingsPanel'

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', href: '/', icon: LayoutDashboard },
  { id: 'library',   label: 'Library',   href: '/library', icon: Library },
  { id: 'notes',     label: 'Notes',     href: '/notes',   icon: FileText },
  { id: 'stats',     label: 'Stats',     href: '/stats',   icon: BarChart3 },
  { id: 'planner',   label: 'Planner',   href: '/planner', icon: Calendar },
]
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/useAppStore'
import { useLibraryStore } from '@/store/useLibraryStore'
import { Tooltip } from '@/components/ui/Tooltip'

function NavItem({
  href, label, icon, active, collapsed, badge,
}: {
  href: string; label: string; icon: React.ReactNode
  active: boolean; collapsed: boolean; badge?: string
}) {
  const cls = cn(
    'flex items-center gap-2.5 h-7 rounded-[var(--radius-sm)] text-xs transition-colors w-full',
    'hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
    collapsed ? 'justify-center px-0' : 'px-2.5',
    active ? 'nav-active font-medium' : 'text-[var(--text-secondary)]'
  )
  const inner = (
    <Link href={href} className={cls}>
      <span className="shrink-0">{icon}</span>
      {!collapsed && <span className="flex-1">{label}</span>}
      {!collapsed && badge && (
        <span className="text-[10px] bg-[var(--accent)] text-[var(--bg-base)] font-semibold rounded-full px-1.5 py-0.5 leading-none min-w-[18px] text-center">
          {badge}
        </span>
      )}
      {collapsed && badge && (
        <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-[var(--accent)] rounded-full" />
      )}
    </Link>
  )
  if (collapsed) {
    return <Tooltip content={label} side="right"><div className="relative">{inner}</div></Tooltip>
  }
  return inner
}

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { sidebarCollapsed, toggleSidebar, openCommandPalette } = useAppStore()
  const { decks, folders, cards, createDeck, getDueCards, getNewCards, getReviewsDue } = useLibraryStore()
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [expandedDecks, setExpandedDecks] = useState<Set<string>>(new Set())
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Today's work: new cards (within daily limit) + due reviews
  const newCards = getNewCards()
  const reviewsDue = getReviewsDue()
  const inboxCount = newCards.length + reviewsDue.length

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href.split('?')[0])

  const toggleFolder = (id: string) =>
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const toggleDeck = (id: string) =>
    setExpandedDecks((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  // Top-level folders (no parent)
  const rootFolders = folders.filter((f) => !f.parentId && !f.isArchived)
  // Top-level decks (no folder)
  const rootDecks = decks.filter((d) => !d.folderId && !d.isArchived)
  // Pinned vs unpinned root decks
  const pinnedDecks = rootDecks.filter((d) => d.isStarred)
  const unpinnedDecks = rootDecks.filter((d) => !d.isStarred)

  // Cards added today counter
  const todayStr = new Date().toISOString().slice(0, 10)
  const cardsAddedToday = cards.filter((c) => c.createdAt.startsWith(todayStr)).length

  // Total cards across all decks in a folder (direct children only for sidebar display)
  const totalCardsInFolder = (folderId: string): number => {
    const deckIds = decks.filter((d) => d.folderId === folderId).map((d) => d.id)
    return cards.filter((c) => deckIds.includes(c.deckId)).length
  }

  const [showNewDeckForm, setShowNewDeckForm] = useState(false)
  const [newDeckName, setNewDeckName] = useState('')
  const [newDeckFolder, setNewDeckFolder] = useState<string | null>(null)

  const handleNewDeck = () => {
    setNewDeckName('')
    setNewDeckFolder(null)
    setShowNewDeckForm(true)
  }

  const handleNewDeckSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const name = newDeckName.trim() || 'New Deck'
    createDeck(name, newDeckFolder)
    setShowNewDeckForm(false)
    router.push('/library')
  }

  const deckCardCount = (deckId: string) =>
    cards.filter((c) => c.deckId === deckId).length


  return (
    <aside
      className={cn(
        'flex flex-col h-screen border-r border-[var(--border)] transition-all duration-150 shrink-0 relative',
        'bg-[var(--bg-surface)]',
        sidebarCollapsed ? 'w-12' : 'w-[220px]'
      )}
    >
      {/* Edge collapse toggle — always visible on hover */}
      <button
        onClick={toggleSidebar}
        className="absolute -right-3 top-1/2 -translate-y-1/2 z-10 w-6 h-6 rounded-full border border-[var(--border)] bg-[var(--bg-surface)] flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity group-hover:opacity-100 shadow-sm hover:bg-[var(--bg-hover)]"
        title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <ChevronLeft
          size={12}
          className={cn('text-[var(--text-muted)] transition-transform duration-150', sidebarCollapsed && 'rotate-180')}
        />
      </button>
      {/* Account area */}
      <div
        className={cn(
          'flex items-center h-11 px-3 border-b border-[var(--border)] shrink-0 gap-2',
          sidebarCollapsed ? 'justify-center' : ''
        )}
      >
        <div className="w-5 h-5 rounded-full bg-[var(--bg-active)] flex items-center justify-center shrink-0">
          <User size={11} className="text-[var(--text-muted)]" />
        </div>
        {!sidebarCollapsed && (
          <>
            <span className="flex-1 text-xs font-medium text-[var(--text-secondary)] truncate">
              Nemo
            </span>
            <ChevronDown size={12} className="text-[var(--text-muted)] shrink-0" />
          </>
        )}
      </div>

      {/* Search bar */}
      <div className="px-2 pt-2 pb-1.5 shrink-0">
        <Tooltip content="Search" shortcut={['Ctrl', 'K']} side="right">
          <button
            onClick={openCommandPalette}
            className={cn(
              'w-full flex items-center gap-2 h-7 rounded-[var(--radius-sm)] text-[var(--text-muted)] text-xs',
              'bg-[var(--bg-hover)] hover:bg-[var(--bg-active)] transition-colors',
              sidebarCollapsed ? 'justify-center px-0' : 'px-2.5'
            )}
          >
            <Search size={12} className="shrink-0" />
            {!sidebarCollapsed && (
              <>
                <span className="flex-1 text-left">Search</span>
                <kbd className="text-[10px] opacity-40 font-mono">Ctrl K</kbd>
              </>
            )}
          </button>
        </Tooltip>
      </div>

      {/* Main nav */}
      <nav className="px-2 pb-1 shrink-0 space-y-0.5">
        {/* Inbox */}
        <NavItem
          href="/study"
          label="Inbox"
          icon={<Inbox size={14} />}
          active={isActive('/study')}
          collapsed={sidebarCollapsed}
          badge={inboxCount > 0 ? String(inboxCount > 99 ? '99+' : inboxCount) : undefined}
        />

        {/* New Cards */}
        <NavItem
          href="/study/session?mode=new"
          label="New Cards"
          icon={<Sparkles size={14} />}
          active={false}
          collapsed={sidebarCollapsed}
          badge={newCards.length > 0 ? String(newCards.length > 99 ? '99+' : newCards.length) : undefined}
        />

        {/* Reviews */}
        <NavItem
          href="/study/session?mode=reviews"
          label="Reviews"
          icon={<RotateCcw size={14} />}
          active={false}
          collapsed={sidebarCollapsed}
          badge={reviewsDue.length > 0 ? String(reviewsDue.length > 99 ? '99+' : reviewsDue.length) : undefined}
        />

        {NAV_ITEMS.map(({ id, label, href, icon: Icon }) => (
          <NavItem
            key={id}
            href={href}
            label={label}
            icon={<Icon size={14} />}
            active={isActive(href)}
            collapsed={sidebarCollapsed}
          />
        ))}
      </nav>

      {/* Divider */}
      <div className="mx-2 border-t border-[var(--border)] mb-1" />

      {/* Decks section */}
      <div className="flex-1 overflow-y-auto px-2">
        {!sidebarCollapsed && (
          <div className="px-1.5 mb-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
              Decks
            </span>
          </div>
        )}

        <div className="space-y-0.5">
          {/* Root folders */}
          {rootFolders.map((folder) => {
            const isExpanded = expandedFolders.has(folder.id)
            const childDecks = decks.filter((d) => d.folderId === folder.id && !d.isArchived)
            return (
              <div key={folder.id}>
                <Tooltip content={folder.name} side="right" className={sidebarCollapsed ? '' : 'hidden'}>
                  <button
                    onClick={() => !sidebarCollapsed && toggleFolder(folder.id)}
                    className={cn(
                      'w-full flex items-center gap-1.5 h-7 rounded-[var(--radius-sm)] text-xs transition-colors',
                      'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
                      sidebarCollapsed ? 'justify-center px-0' : 'px-1.5'
                    )}
                  >
                    <ChevronRight
                      size={12}
                      className={cn(
                        'shrink-0 text-[var(--text-muted)] transition-transform duration-150',
                        isExpanded && 'rotate-90',
                        sidebarCollapsed && 'hidden'
                      )}
                    />
                    <BookOpen size={13} className="shrink-0" />
                    {!sidebarCollapsed && (
                      <>
                        <span className="flex-1 text-left truncate">{folder.name}</span>
                        <span className="text-[10px] text-[var(--text-muted)] shrink-0">
                          {totalCardsInFolder(folder.id)}
                        </span>
                      </>
                    )}
                  </button>
                </Tooltip>

                {isExpanded && !sidebarCollapsed && childDecks.map((deck) => (
                  <Link
                    key={deck.id}
                    href="/library"
                    className="flex items-center gap-1.5 h-7 pl-6 pr-1.5 rounded-[var(--radius-sm)] text-xs text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)] transition-colors"
                  >
                    <span className="flex-1 truncate">{deck.name}</span>
                    <span className="text-[10px] text-[var(--text-muted)] shrink-0">
                      {deckCardCount(deck.id)}
                    </span>
                  </Link>
                ))}
              </div>
            )
          })}

          {/* Pinned decks (starred, no folder) */}
          {pinnedDecks.length > 0 && !sidebarCollapsed && (
            <div className="px-1.5 pt-1 pb-0.5">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)] flex items-center gap-1">
                <span>★</span> Pinned
              </span>
            </div>
          )}
          {pinnedDecks.map((deck) => (
            <Tooltip key={deck.id} content={deck.name} side="right" className={sidebarCollapsed ? '' : 'hidden'}>
              <Link
                href="/library"
                className={cn(
                  'flex items-center gap-1.5 h-7 rounded-[var(--radius-sm)] text-xs transition-colors',
                  'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
                  sidebarCollapsed ? 'justify-center px-0' : 'px-1.5'
                )}
              >
                <ChevronRight size={12} className={cn('shrink-0 text-[var(--text-muted)] opacity-0', sidebarCollapsed && 'hidden')} />
                <BookOpen size={13} className="shrink-0" />
                {!sidebarCollapsed && (
                  <>
                    <span className="flex-1 truncate">{deck.name}</span>
                    <span className="text-[10px] text-[var(--text-muted)] shrink-0">
                      {deckCardCount(deck.id)}
                    </span>
                  </>
                )}
              </Link>
            </Tooltip>
          ))}

          {/* Root decks (no folder, not starred) */}
          {unpinnedDecks.map((deck) => (
            <Tooltip key={deck.id} content={deck.name} side="right" className={sidebarCollapsed ? '' : 'hidden'}>
              <Link
                href="/library"
                className={cn(
                  'flex items-center gap-1.5 h-7 rounded-[var(--radius-sm)] text-xs transition-colors',
                  'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
                  sidebarCollapsed ? 'justify-center px-0' : 'px-1.5'
                )}
              >
                <ChevronRight size={12} className={cn('shrink-0 text-[var(--text-muted)] opacity-0', sidebarCollapsed && 'hidden')} />
                <BookOpen size={13} className="shrink-0" />
                {!sidebarCollapsed && (
                  <>
                    <span className="flex-1 truncate">{deck.name}</span>
                    <span className="text-[10px] text-[var(--text-muted)] shrink-0">
                      {deckCardCount(deck.id)}
                    </span>
                  </>
                )}
              </Link>
            </Tooltip>
          ))}

          {/* + New Deck */}
          {!sidebarCollapsed && !showNewDeckForm && (
            <button
              onClick={handleNewDeck}
              className="flex items-center gap-1.5 h-7 px-1.5 w-full rounded-[var(--radius-sm)] text-xs text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)] transition-colors"
            >
              <Plus size={12} className="shrink-0" />
              <span>New Deck</span>
            </button>
          )}

          {/* Inline new deck form */}
          {!sidebarCollapsed && showNewDeckForm && (
            <form onSubmit={handleNewDeckSubmit} className="px-1.5 py-2 space-y-1.5 animate-fade-in">
              <input
                autoFocus
                value={newDeckName}
                onChange={(e) => setNewDeckName(e.target.value)}
                placeholder="Deck name..."
                className="w-full text-xs bg-[var(--bg-hover)] border border-[var(--accent)] rounded-[var(--radius-sm)] px-2 py-1 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
              />
              <select
                value={newDeckFolder ?? ''}
                onChange={(e) => setNewDeckFolder(e.target.value || null)}
                className="w-full text-xs bg-[var(--bg-hover)] border border-[var(--border)] rounded-[var(--radius-sm)] px-2 py-1 text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              >
                <option value="">No folder (root)</option>
                {folders.filter((f) => !f.isArchived).map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
              <div className="flex gap-1">
                <button
                  type="submit"
                  className="flex-1 text-[10px] font-medium py-1 rounded-[var(--radius-sm)] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
                >
                  Create
                </button>
                <button
                  type="button"
                  onClick={() => setShowNewDeckForm(false)}
                  className="text-[10px] px-2 py-1 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Cards added today */}
      {!sidebarCollapsed && cardsAddedToday > 0 && (
        <div className="px-3 py-1.5 text-[10px] text-[var(--text-muted)] flex items-center gap-1.5">
          <Plus size={9} />
          {cardsAddedToday} cards added today
        </div>
      )}

      {/* Bottom actions */}
      <div className="px-2 pb-2 pt-1 border-t border-[var(--border)] shrink-0 space-y-0.5">
        {sidebarCollapsed ? (
          <Tooltip content="Settings" side="right">
            <button
              onClick={() => setSettingsOpen(true)}
              className="flex items-center justify-center h-7 w-full rounded-[var(--radius-sm)] text-xs transition-colors text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]"
            >
              <Settings size={13} className="shrink-0" />
            </button>
          </Tooltip>
        ) : (
          <button
            onClick={() => setSettingsOpen(true)}
            className="flex items-center gap-2.5 h-7 px-2.5 w-full rounded-[var(--radius-sm)] text-xs transition-colors text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]"
          >
            <Settings size={13} className="shrink-0" />
            Settings
          </button>
        )}

        {sidebarCollapsed ? (
          <Tooltip content="Trash" side="right">
            <Link
              href="/trash"
              className="flex items-center justify-center h-7 w-full rounded-[var(--radius-sm)] text-xs transition-colors text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]"
            >
              <Trash2 size={13} className="shrink-0" />
            </Link>
          </Tooltip>
        ) : (
          <Link
            href="/trash"
            className="flex items-center gap-2.5 h-7 px-2.5 rounded-[var(--radius-sm)] text-xs transition-colors text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]"
          >
            <Trash2 size={13} className="shrink-0" />
            Trash
          </Link>
        )}

        {/* Collapse toggle */}
        <Tooltip content={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} side="right">
          <button
            onClick={toggleSidebar}
            className={cn(
              'flex items-center gap-2.5 h-7 w-full rounded-[var(--radius-sm)] text-xs transition-colors',
              'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]',
              sidebarCollapsed ? 'justify-center px-0' : 'px-2.5'
            )}
          >
            <ChevronLeft
              size={13}
              className={cn('shrink-0 transition-transform duration-200', sidebarCollapsed && 'rotate-180')}
            />
            {!sidebarCollapsed && 'Collapse'}
          </button>
        </Tooltip>
      </div>

      {/* Settings slide panel */}
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </aside>
  )
}
