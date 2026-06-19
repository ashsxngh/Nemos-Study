'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Folder, BookOpen, Star, MoreHorizontal, ChevronRight,
  Home, Grid3X3, List, Search, ArrowLeft,
  Archive, Trash2, Play, GripVertical, Rows3, ChevronDown,
} from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
} from '@dnd-kit/core'
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Progress } from '@/components/ui/Progress'
import { Dialog } from '@/components/ui/Dialog'
import { DeckView } from '@/components/library/DeckView'
import { useLibraryStore } from '@/store/useLibraryStore'
import { useAppStore } from '@/store/useAppStore'
import type { FolderColor, Folder as FolderType, Deck as DeckType } from '@/lib/types'

const FOLDER_COLORS: Record<FolderColor, string> = {
  default: 'text-[var(--text-muted)]',
  red: 'text-red-400',
  orange: 'text-orange-400',
  yellow: 'text-yellow-400',
  green: 'text-emerald-400',
  blue: 'text-sky-400',
  purple: 'text-purple-400',
  pink: 'text-pink-400',
}

type ViewMode = 'grid' | 'list' | 'table'
type SortBy = 'alpha' | 'due' | 'mastery' | 'recent'

interface LibraryBrowserProps {
  onNewFolder?: () => void
  onNewDeck?: (folderId?: string | null) => void
  onFolderChange?: (folderId: string | null) => void
}

function getRecursiveCardCount(
  folderId: string,
  folders: FolderType[],
  decks: DeckType[],
  getDeckCards: (id: string) => { length: number },
): number {
  const directDecks = decks.filter((d) => d.folderId === folderId)
  const directCount = directDecks.reduce((sum, d) => sum + getDeckCards(d.id).length, 0)
  const childFolders = folders.filter((f) => f.parentId === folderId)
  return directCount + childFolders.reduce((sum, f) => sum + getRecursiveCardCount(f.id, folders, decks, getDeckCards), 0)
}

// ── Confirm hard-delete dialog ────────────────────────────────────────────────

interface ConfirmDeleteState {
  type: 'folder' | 'deck'
  id: string
  name: string
  cardCount: number
}

function ConfirmDeleteDialog({
  target,
  onClose,
  onConfirm,
}: {
  target: ConfirmDeleteState | null
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog
      open={!!target}
      onClose={onClose}
      title={target ? `Delete ${target.type}?` : ''}
      size="sm"
    >
      {target && (
        <div className="p-4 space-y-3">
          <p className="text-sm text-[var(--text-primary)]">
            This will permanently delete <strong>{target.cardCount}</strong>{' '}
            {target.cardCount === 1 ? 'card' : 'cards'} in &quot;{target.name}&quot;. This cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={onConfirm}>
              Delete
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}

// ── Dropdown menu ─────────────────────────────────────────────────────────────

interface DropdownItem {
  label: string
  icon: React.ReactNode
  onClick: () => void
  danger?: boolean
}

function ItemDropdown({ items }: { items: DropdownItem[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        close()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, close])

  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        onMouseDown={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--bg-active)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        aria-label="More options"
      >
        <MoreHorizontal size={13} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[140px] bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius-sm)] shadow-lg py-0.5 overflow-hidden">
          {items.map((item, i) => (
            <button
              key={i}
              onMouseDown={(e) => {
                e.stopPropagation()
                item.onClick()
                setOpen(false)
              }}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)] transition-colors text-left',
                item.danger ? 'text-[var(--danger)]' : 'text-[var(--text-primary)]'
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Root drop zone ────────────────────────────────────────────────────────────

function RootDropZone({ isDragging }: { isDragging: boolean }) {
  const { setNodeRef, isOver } = useDroppable({
    id: 'root-drop-zone',
    data: { type: 'root' },
  })

  if (!isDragging) return null

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'mt-4 flex items-center justify-center rounded-[var(--radius)] border-2 border-dashed py-4 text-xs transition-colors',
        isOver
          ? 'border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent)]'
          : 'border-[var(--border)] text-[var(--text-muted)]'
      )}
    >
      Drop here to move to root
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function LibraryBrowser({ onNewFolder, onNewDeck, onFolderChange }: LibraryBrowserProps) {
  const {
    folders, decks, getDeckCards, getDeckMastery, getDueCards, sessions,
    updateFolder, deleteFolder, updateDeck, deleteDeck,
  } = useLibraryStore()

  const [view, setView] = useState<ViewMode>('grid')
  const [search, setSearch] = useState('')
  const [folderStack, setFolderStack] = useState<(string | null)[]>([null])
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null)
  const [draggingDeckId, setDraggingDeckId] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<SortBy>('alpha')
  const [activeTags, setActiveTags] = useState<string[]>([])
  const [confirmDelete, setConfirmDelete] = useState<ConfirmDeleteState | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  )

  const currentFolderId = folderStack[folderStack.length - 1]
  const currentFolder = folders.find((f) => f.id === currentFolderId) ?? null

  // ── Auto-open last deck on mount ──────────────────────────────────────────
  useEffect(() => {
    const lastId = useAppStore.getState().lastOpenDeckId
    if (lastId && decks.some((d) => d.id === lastId)) {
      setActiveDeckId(lastId)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const buildPath = (fid: string | null): (FolderType | null)[] => {
    if (!fid) return [null]
    const folder = folders.find((f) => f.id === fid)
    if (!folder) return [null]
    return [...buildPath(folder.parentId), folder]
  }
  const breadcrumbs = buildPath(currentFolderId)

  const visibleFolders = folders.filter((f) => {
    const inCurrent = f.parentId === currentFolderId
    const matchesSearch = !search || f.name.toLowerCase().includes(search.toLowerCase())
    return inCurrent && matchesSearch
  })

  const visibleDecks = decks.filter((d) => {
    const inCurrent = d.folderId === currentFolderId
    const matchesSearch = !search || d.name.toLowerCase().includes(search.toLowerCase())
    return inCurrent && matchesSearch
  })

  // ── All unique tags in current folder ────────────────────────────────────
  const allTags = [...new Set(visibleDecks.flatMap((d) => d.tags))].sort()

  // ── Toggle tag filter ─────────────────────────────────────────────────────
  const toggleTag = (tag: string) => {
    setActiveTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    )
  }

  // ── Sort + filter decks ───────────────────────────────────────────────────
  const sortedDecks = [...visibleDecks]
    .filter((d) => activeTags.length === 0 || activeTags.every((t) => d.tags.includes(t)))
    .sort((a, b) => {
      if (sortBy === 'due') return getDueCards(b.id).length - getDueCards(a.id).length
      if (sortBy === 'mastery') return getDeckMastery(a.id) - getDeckMastery(b.id)
      if (sortBy === 'recent') {
        const lastA = sessions
          .filter((s) => s.deckId === a.id && s.endedAt)
          .sort((x, y) => new Date(y.startedAt).getTime() - new Date(x.startedAt).getTime())[0]
        const lastB = sessions
          .filter((s) => s.deckId === b.id && s.endedAt)
          .sort((x, y) => new Date(y.startedAt).getTime() - new Date(x.startedAt).getTime())[0]
        const tA = lastA ? new Date(lastA.startedAt).getTime() : 0
        const tB = lastB ? new Date(lastB.startedAt).getTime() : 0
        return tB - tA
      }
      return a.name.localeCompare(b.name)
    })

  const navigateToFolder = (folderId: string | null) => {
    setFolderStack((prev) => [...prev, folderId])
    setActiveDeckId(null)
    setSearch('')
    setActiveTags([])
    onFolderChange?.(folderId)
  }

  const navigateToBreadcrumb = (index: number) => {
    const newStack = folderStack.slice(0, index + 1)
    setFolderStack(newStack)
    setActiveDeckId(null)
    setSearch('')
    setActiveTags([])
    onFolderChange?.(newStack[newStack.length - 1] ?? null)
  }

  // ── Open deck and remember it ─────────────────────────────────────────────
  const openDeck = (deckId: string) => {
    setActiveDeckId(deckId)
    useAppStore.getState().setLastOpenDeck(deckId)
  }

  function handleDragStart(event: DragStartEvent) {
    const deckId = (event.active.data.current as { deckId?: string } | undefined)?.deckId
    setDraggingDeckId(deckId ?? null)
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setDraggingDeckId(null)

    if (!active) return

    const deckId = (active.data.current as { deckId?: string } | undefined)?.deckId
    if (!deckId) return

    if (over && over.data.current?.type === 'folder') {
      const folderId = (over.data.current as { folderId: string }).folderId
      updateDeck(deckId, { folderId })
    } else if (over && over.data.current?.type === 'root') {
      updateDeck(deckId, { folderId: null })
    } else if (!over) {
      // Dropped on nothing — move to root
      updateDeck(deckId, { folderId: null })
    }
  }

  const draggingDeck = draggingDeckId ? decks.find((d) => d.id === draggingDeckId) : null

  if (activeDeckId) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-5 pt-4 pb-0">
          <Button
            variant="ghost"
            size="sm"
            icon={<ArrowLeft size={13} />}
            onClick={() => setActiveDeckId(null)}
          >
            Back
          </Button>
        </div>
        <DeckView
          deckId={activeDeckId}
          onStudy={() => {
            window.location.href = `/study/session?deck=${activeDeckId}`
          }}
        />
      </div>
    )
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="p-5">
        {/* Breadcrumb + controls */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center gap-1 text-xs text-[var(--text-muted)] flex-1 flex-wrap">
            {breadcrumbs.map((item, idx) => (
              <span key={idx} className="flex items-center gap-1">
                {idx === 0 ? (
                  <button
                    onClick={() => navigateToBreadcrumb(0)}
                    className={cn(
                      'flex items-center gap-1 hover:text-[var(--text-primary)] transition-colors',
                      idx === breadcrumbs.length - 1 && 'text-[var(--text-primary)] font-medium'
                    )}
                  >
                    <Home size={12} />
                    <span>All</span>
                  </button>
                ) : (
                  <button
                    onClick={() => navigateToBreadcrumb(idx)}
                    className={cn(
                      'hover:text-[var(--text-primary)] transition-colors',
                      idx === breadcrumbs.length - 1 && 'text-[var(--text-primary)] font-medium'
                    )}
                  >
                    {item?.name}
                  </button>
                )}
                {idx < breadcrumbs.length - 1 && <ChevronRight size={11} />}
              </span>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Input
              placeholder="Search library..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              icon={<Search size={12} />}
              className="w-48"
            />
            <div className="flex border border-[var(--border)] rounded-[var(--radius-sm)] overflow-hidden">
              <button
                onClick={() => setView('grid')}
                className={cn(
                  'w-7 h-7 flex items-center justify-center transition-colors',
                  view === 'grid'
                    ? 'bg-[var(--bg-active)] text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'
                )}
              >
                <Grid3X3 size={13} />
              </button>
              <button
                onClick={() => setView('list')}
                className={cn(
                  'w-7 h-7 flex items-center justify-center transition-colors',
                  view === 'list'
                    ? 'bg-[var(--bg-active)] text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'
                )}
              >
                <List size={13} />
              </button>
              <button
                onClick={() => setView('table')}
                title="Tree table view"
                className={cn(
                  'w-7 h-7 flex items-center justify-center transition-colors',
                  view === 'table'
                    ? 'bg-[var(--bg-active)] text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'
                )}
              >
                <Rows3 size={13} />
              </button>
            </div>
          </div>
        </div>

        {/* Sort + tag filter toolbar (shown when there are decks) */}
        {view !== 'table' && visibleDecks.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-5">
            {/* Sort dropdown */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
              className="text-xs bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius-sm)] px-2 py-1 text-[var(--text-secondary)] hover:border-[var(--border-strong)] transition-colors outline-none cursor-pointer"
              aria-label="Sort decks"
            >
              <option value="alpha">A – Z</option>
              <option value="due">Most due</option>
              <option value="mastery">Least mastered</option>
              <option value="recent">Recently studied</option>
            </select>

            {/* Tag chips */}
            {allTags.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                {allTags.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => toggleTag(tag)}
                    className={cn(
                      'text-[10px] px-2 py-0.5 rounded-full border transition-colors',
                      activeTags.includes(tag)
                        ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                        : 'bg-[var(--bg-surface)] border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]'
                    )}
                  >
                    #{tag}
                  </button>
                ))}
                {activeTags.length > 0 && (
                  <button
                    onClick={() => setActiveTags([])}
                    className="text-[10px] text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors px-1"
                    aria-label="Clear tag filters"
                  >
                    ✕ clear
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Empty state */}
        {visibleFolders.length === 0 && visibleDecks.length === 0 && !search && (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
            <div className="w-10 h-10 rounded-full bg-[var(--bg-active)] flex items-center justify-center">
              <Folder size={18} className="text-[var(--text-muted)]" />
            </div>
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">
                {currentFolder ? `"${currentFolder.name}" is empty` : 'Your library is empty'}
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Create a folder or deck to get started.
              </p>
            </div>
            <div className="flex gap-2">
              {onNewFolder && (
                <Button variant="secondary" size="sm" onClick={onNewFolder}>New Folder</Button>
              )}
              {onNewDeck && (
                <Button variant="primary" size="sm" onClick={() => onNewDeck(currentFolderId)}>New Deck</Button>
              )}
            </div>
          </div>
        )}

        {/* Search empty state */}
        {view !== 'table' && visibleFolders.length === 0 && visibleDecks.length === 0 && search && (
          <div className="flex flex-col items-center justify-center py-16 text-[var(--text-muted)] text-sm">
            No results for &quot;{search}&quot;
          </div>
        )}

        {/* Tree table view */}
        {view === 'table' && (visibleFolders.length > 0 || visibleDecks.length > 0 || search) && (
          <LibraryTreeTable rootId={currentFolderId} search={search} onOpenDeck={openDeck} />
        )}

        {/* Folders section */}
        {view !== 'table' && visibleFolders.length > 0 && (
          <section className="mb-6">
            <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-widest mb-3">
              Folders
            </h3>
            <div
              className={cn(
                view === 'grid'
                  ? 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3'
                  : 'space-y-1'
              )}
            >
              {visibleFolders.map((folder) => {
                const folderMenuItems: DropdownItem[] = [
                  {
                    label: folder.isStarred ? 'Unstar' : 'Star',
                    icon: <Star size={12} />,
                    onClick: () => updateFolder(folder.id, { isStarred: !folder.isStarred }),
                  },
                  {
                    label: folder.isArchived ? 'Unarchive' : 'Archive',
                    icon: <Archive size={12} />,
                    onClick: () => updateFolder(folder.id, { isArchived: !folder.isArchived }),
                  },
                  {
                    label: 'Delete',
                    icon: <Trash2 size={12} />,
                    danger: true,
                    onClick: () => {
                      setConfirmDelete({
                        type: 'folder',
                        id: folder.id,
                        name: folder.name,
                        cardCount: getRecursiveCardCount(folder.id, folders, decks, getDeckCards),
                      })
                    },
                  },
                ]
                const totalCards = getRecursiveCardCount(folder.id, folders, decks, getDeckCards)
                const childCount = folders.filter((f) => f.parentId === folder.id).length
                return view === 'grid' ? (
                  <FolderCardGrid
                    key={folder.id}
                    folder={folder}
                    cardCount={totalCards}
                    childCount={childCount}
                    onClick={() => navigateToFolder(folder.id)}
                    menuItems={folderMenuItems}
                  />
                ) : (
                  <FolderCardList
                    key={folder.id}
                    folder={folder}
                    cardCount={totalCards}
                    onClick={() => navigateToFolder(folder.id)}
                    menuItems={folderMenuItems}
                  />
                )
              })}
            </div>
          </section>
        )}

        {/* Decks section */}
        {view !== 'table' && sortedDecks.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-widest mb-3">
              Decks
            </h3>
            <div
              className={cn(
                view === 'grid'
                  ? 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3'
                  : 'space-y-1'
              )}
            >
              {sortedDecks.map((deck) => {
                const cardCount = getDeckCards(deck.id).length
                const dueCount = getDueCards(deck.id).length
                const mastery = getDeckMastery(deck.id)
                const deckMenuItems: DropdownItem[] = [
                  {
                    label: deck.isStarred ? 'Unstar' : 'Star',
                    icon: <Star size={12} />,
                    onClick: () => updateDeck(deck.id, { isStarred: !deck.isStarred }),
                  },
                  {
                    label: deck.isArchived ? 'Unarchive' : 'Archive',
                    icon: <Archive size={12} />,
                    onClick: () => updateDeck(deck.id, { isArchived: !deck.isArchived }),
                  },
                  {
                    label: 'Delete',
                    icon: <Trash2 size={12} />,
                    danger: true,
                    onClick: () => {
                      setConfirmDelete({
                        type: 'deck',
                        id: deck.id,
                        name: deck.name,
                        cardCount,
                      })
                    },
                  },
                ]
                return view === 'grid' ? (
                  <DeckCardGrid
                    key={deck.id}
                    deck={deck}
                    cardCount={cardCount}
                    dueCount={dueCount}
                    mastery={mastery}
                    onClick={() => openDeck(deck.id)}
                    menuItems={deckMenuItems}
                  />
                ) : (
                  <DeckCardList
                    key={deck.id}
                    deck={deck}
                    cardCount={cardCount}
                    dueCount={dueCount}
                    mastery={mastery}
                    onClick={() => openDeck(deck.id)}
                    menuItems={deckMenuItems}
                  />
                )
              })}
            </div>
          </section>
        )}

        {/* Empty filtered state — decks exist but filtered out */}
        {view !== 'table' && visibleDecks.length > 0 && sortedDecks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-10 text-[var(--text-muted)] text-xs">
            No decks match the selected tags.
          </div>
        )}

        {/* Root drop zone — visible only while dragging */}
        <RootDropZone isDragging={!!draggingDeckId} />
      </div>

      {/* Drag overlay — card ghost that follows the cursor */}
      <DragOverlay>
        {draggingDeck ? (
          <div className="bg-[var(--bg-surface)] border-2 border-[var(--accent)] rounded-[var(--radius)] p-3 shadow-xl opacity-90 w-40">
            <p className="text-xs font-medium text-[var(--text-primary)] truncate">
              {draggingDeck.name}
            </p>
          </div>
        ) : null}
      </DragOverlay>

      <ConfirmDeleteDialog
        target={confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete?.type === 'folder') deleteFolder(confirmDelete.id)
          else if (confirmDelete?.type === 'deck') deleteDeck(confirmDelete.id)
          setConfirmDelete(null)
        }}
      />
    </DndContext>
  )
}

// ── Tree table view ───────────────────────────────────────────────────────────

interface DeckCounts {
  newCount: number
  dueCount: number
  total: number
}

function LibraryTreeTable({
  rootId,
  search,
  onOpenDeck,
}: {
  rootId: string | null
  search: string
  onOpenDeck: (deckId: string) => void
}) {
  const {
    folders, decks, getDeckCards, getNewCards, getReviewsDue,
    updateFolder, deleteFolder, updateDeck, deleteDeck,
  } = useLibraryStore()

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState<ConfirmDeleteState | null>(null)
  const q = search.toLowerCase()

  const toggleFolder = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const deckCounts = (deckId: string): DeckCounts => ({
    newCount: getNewCards(deckId).length,
    dueCount: getReviewsDue(deckId).length,
    total: getDeckCards(deckId).length,
  })

  const folderCounts = (folderId: string): DeckCounts => {
    const direct = decks
      .filter((d) => d.folderId === folderId)
      .map((d) => deckCounts(d.id))
    const nested = folders
      .filter((f) => f.parentId === folderId)
      .map((f) => folderCounts(f.id))
    return [...direct, ...nested].reduce(
      (acc, c) => ({
        newCount: acc.newCount + c.newCount,
        dueCount: acc.dueCount + c.dueCount,
        total: acc.total + c.total,
      }),
      { newCount: 0, dueCount: 0, total: 0 }
    )
  }

  // Search helpers — a folder is visible if it or anything inside it matches
  const subtreeMatches = (folderId: string): boolean => {
    if (decks.some((d) => d.folderId === folderId && d.name.toLowerCase().includes(q))) return true
    return folders.some(
      (f) => f.parentId === folderId && (f.name.toLowerCase().includes(q) || subtreeMatches(f.id))
    )
  }

  const folderMenu = (folder: FolderType): DropdownItem[] => [
    {
      label: folder.isStarred ? 'Unstar' : 'Star',
      icon: <Star size={12} />,
      onClick: () => updateFolder(folder.id, { isStarred: !folder.isStarred }),
    },
    {
      label: folder.isArchived ? 'Unarchive' : 'Archive',
      icon: <Archive size={12} />,
      onClick: () => updateFolder(folder.id, { isArchived: !folder.isArchived }),
    },
    {
      label: 'Delete',
      icon: <Trash2 size={12} />,
      danger: true,
      onClick: () => {
        setConfirmDelete({
          type: 'folder',
          id: folder.id,
          name: folder.name,
          cardCount: folderCounts(folder.id).total,
        })
      },
    },
  ]

  const deckMenu = (deck: DeckType): DropdownItem[] => [
    {
      label: deck.isStarred ? 'Unstar' : 'Star',
      icon: <Star size={12} />,
      onClick: () => updateDeck(deck.id, { isStarred: !deck.isStarred }),
    },
    {
      label: deck.isArchived ? 'Unarchive' : 'Archive',
      icon: <Archive size={12} />,
      onClick: () => updateDeck(deck.id, { isArchived: !deck.isArchived }),
    },
    {
      label: 'Delete',
      icon: <Trash2 size={12} />,
      danger: true,
      onClick: () => {
        setConfirmDelete({
          type: 'deck',
          id: deck.id,
          name: deck.name,
          cardCount: deckCounts(deck.id).total,
        })
      },
    },
  ]

  const renderRows = (parentId: string | null, depth: number): React.ReactNode[] => {
    const rows: React.ReactNode[] = []

    const childFolders = folders.filter((f) => {
      if (f.parentId !== parentId) return false
      return !q || f.name.toLowerCase().includes(q) || subtreeMatches(f.id)
    })
    const childDecks = decks.filter((d) => {
      if (d.folderId !== parentId) return false
      return !q || d.name.toLowerCase().includes(q)
    })

    for (const folder of childFolders) {
      const counts = folderCounts(folder.id)
      // Searching auto-expands; otherwise respect collapsed state
      const isOpen = q ? true : !collapsed.has(folder.id)
      rows.push(
        <div
          key={`folder-${folder.id}`}
          className="grid grid-cols-12 gap-2 items-center px-4 py-2.5 hover:bg-[var(--bg-hover)] transition-colors cursor-pointer group"
          onClick={() => toggleFolder(folder.id)}
        >
          <div
            className="col-span-6 flex items-center gap-2 min-w-0"
            style={{ paddingLeft: depth * 20 }}
          >
            {isOpen ? (
              <ChevronDown size={13} className="text-[var(--text-muted)] shrink-0" />
            ) : (
              <ChevronRight size={13} className="text-[var(--text-muted)] shrink-0" />
            )}
            <Folder size={15} className={cn('shrink-0', FOLDER_COLORS[folder.color])} />
            <span className="text-sm font-medium text-[var(--text-primary)] truncate">{folder.name}</span>
            {folder.isStarred && <Star size={11} className="text-yellow-400 fill-yellow-400 shrink-0" />}
          </div>
          <div className="col-span-1 text-center text-xs text-[var(--text-muted)]">
            {counts.newCount > 0 ? counts.newCount : '–'}
          </div>
          <div className={cn('col-span-1 text-center text-xs font-semibold', counts.dueCount > 0 ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]')}>
            {counts.dueCount > 0 ? counts.dueCount : '–'}
          </div>
          <div className="col-span-1 text-center text-xs text-[var(--text-muted)]">{counts.total}</div>
          <div className="col-span-3 flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
            <ItemDropdown items={folderMenu(folder)} />
          </div>
        </div>
      )
      if (isOpen) rows.push(...renderRows(folder.id, depth + 1))
    }

    for (const deck of childDecks) {
      const counts = deckCounts(deck.id)
      rows.push(
        <div
          key={`deck-${deck.id}`}
          className="grid grid-cols-12 gap-2 items-center px-4 py-2.5 hover:bg-[var(--bg-hover)] transition-colors cursor-pointer group border-l-2 border-transparent hover:border-[var(--accent)]"
          onClick={() => onOpenDeck(deck.id)}
        >
          <div
            className="col-span-6 flex items-center gap-2 min-w-0"
            style={{ paddingLeft: depth * 20 + 17 }}
          >
            <BookOpen size={14} className="text-[var(--accent)] shrink-0" />
            <span className="text-sm text-[var(--text-primary)] truncate group-hover:text-[var(--accent)] transition-colors">
              {deck.name}
            </span>
            {deck.isStarred && <Star size={11} className="text-yellow-400 fill-yellow-400 shrink-0" />}
          </div>
          <div className={cn('col-span-1 text-center text-xs', counts.newCount > 0 ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]')}>
            {counts.newCount > 0 ? counts.newCount : '–'}
          </div>
          <div className={cn('col-span-1 text-center text-xs font-semibold', counts.dueCount > 0 ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]')}>
            {counts.dueCount > 0 ? counts.dueCount : '–'}
          </div>
          <div className="col-span-1 text-center text-xs text-[var(--text-muted)]">{counts.total}</div>
          <div className="col-span-3 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <a
              href={`/study/session?deck=${deck.id}`}
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 text-[10px] text-[var(--accent)] bg-[var(--accent-subtle)] px-1.5 py-0.5 rounded-full hover:bg-[var(--accent)] hover:text-white transition-colors"
            >
              <Play size={9} /> Study
            </a>
            <ItemDropdown items={deckMenu(deck)} />
          </div>
        </div>
      )
    }

    return rows
  }

  const rows = renderRows(rootId, 0)

  return (
    <div className="border border-[var(--border)] rounded-[var(--radius)] overflow-hidden bg-[var(--bg-surface)]">
      {/* Header */}
      <div className="grid grid-cols-12 gap-2 px-4 py-2 border-b border-[var(--border)] bg-[var(--bg-hover)] text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
        <div className="col-span-6">Name</div>
        <div className="col-span-1 text-center">New</div>
        <div className="col-span-1 text-center">Due</div>
        <div className="col-span-1 text-center">Total</div>
        <div className="col-span-3 text-right">Actions</div>
      </div>
      {rows.length > 0 ? (
        <div className="divide-y divide-[var(--border)]">{rows}</div>
      ) : (
        <div className="py-10 text-center text-xs text-[var(--text-muted)]">
          {search ? `No results for "${search}"` : 'Nothing here yet.'}
        </div>
      )}

      <ConfirmDeleteDialog
        target={confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete?.type === 'folder') deleteFolder(confirmDelete.id)
          else if (confirmDelete?.type === 'deck') deleteDeck(confirmDelete.id)
          setConfirmDelete(null)
        }}
      />
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FolderCardGrid({
  folder,
  cardCount,
  childCount,
  onClick,
  menuItems,
}: {
  folder: FolderType
  cardCount: number
  childCount: number
  onClick: () => void
  menuItems: DropdownItem[]
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `folder-${folder.id}`,
    data: { type: 'folder', folderId: folder.id },
  })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'relative text-left bg-[var(--bg-surface)] border rounded-[var(--radius)] p-3.5 hover:bg-[var(--bg-hover)] transition-colors group cursor-pointer',
        isOver
          ? 'border-[var(--accent)] ring-2 ring-[var(--accent)] ring-opacity-40 bg-[var(--accent-subtle)]'
          : 'border-[var(--border)] hover:border-[var(--border-strong)]'
      )}
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-3">
        <Folder size={20} className={FOLDER_COLORS[folder.color]} />
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {folder.isStarred && <Star size={12} className="text-yellow-400 fill-yellow-400" />}
          <ItemDropdown items={menuItems} />
        </div>
      </div>
      <p className="text-sm font-medium text-[var(--text-primary)] truncate mb-1">{folder.name}</p>
      <p className="text-[10px] text-[var(--text-muted)]">
        {childCount} folders · {cardCount} cards
      </p>
    </div>
  )
}

function FolderCardList({
  folder,
  cardCount,
  onClick,
  menuItems,
}: {
  folder: FolderType
  cardCount: number
  onClick: () => void
  menuItems: DropdownItem[]
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `folder-${folder.id}`,
    data: { type: 'folder', folderId: folder.id },
  })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'w-full flex items-center gap-3 px-3 py-2 rounded-[var(--radius-sm)] transition-colors group text-left cursor-pointer',
        isOver
          ? 'border border-[var(--accent)] bg-[var(--accent-subtle)]'
          : 'hover:bg-[var(--bg-hover)]'
      )}
      onClick={onClick}
    >
      <Folder size={15} className={FOLDER_COLORS[folder.color]} />
      <span className="flex-1 text-sm text-[var(--text-primary)] truncate">{folder.name}</span>
      <span className="text-xs text-[var(--text-muted)]">{cardCount} cards</span>
      {folder.isStarred && <Star size={11} className="text-yellow-400 fill-yellow-400" />}
      <div className="opacity-0 group-hover:opacity-100 transition-opacity">
        <ItemDropdown items={menuItems} />
      </div>
      <ChevronRight size={13} className="text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
    </div>
  )
}

function DeckCardGrid({
  deck, cardCount, dueCount, mastery, onClick, menuItems,
}: {
  deck: DeckType; cardCount: number; dueCount: number; mastery: number
  onClick: () => void; menuItems: DropdownItem[]
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `deck-${deck.id}`,
    data: { type: 'deck', deckId: deck.id },
  })

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="relative text-left bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-3.5 hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] transition-colors group"
    >
      {/* Top row: drag handle + icon + actions */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          {/* Drag handle — left of icon, not overlapping */}
          <button
            {...listeners}
            {...attributes}
            className="opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing text-[var(--text-muted)] hover:text-[var(--text-primary)] p-0.5 rounded shrink-0"
            onClick={(e) => e.stopPropagation()}
            aria-label="Drag to move deck"
          >
            <GripVertical size={13} />
          </button>
          <BookOpen size={16} className="text-[var(--accent)] shrink-0" />
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <a
            href={`/study/session?deck=${deck.id}`}
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1 text-[10px] text-[var(--accent)] bg-[var(--accent-subtle)] px-1.5 py-0.5 rounded-full hover:bg-[var(--accent)] hover:text-white transition-colors"
          >
            <Play size={9} /> Study
          </a>
          <ItemDropdown items={menuItems} />
        </div>
      </div>

      {/* Clickable body */}
      <div className="cursor-pointer" onClick={onClick}>
        <p className="text-sm font-medium text-[var(--text-primary)] truncate mb-1">{deck.name}</p>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] text-[var(--text-muted)]">{cardCount} cards</span>
          {dueCount > 0 && <Badge variant="accent">{dueCount} due</Badge>}
        </div>
        <Progress value={mastery} size="sm" color={mastery >= 70 ? 'success' : mastery >= 40 ? 'accent' : 'warning'} />
      </div>
    </div>
  )
}

function DeckCardList({
  deck, cardCount, dueCount, mastery, onClick, menuItems,
}: {
  deck: DeckType; cardCount: number; dueCount: number; mastery: number
  onClick: () => void; menuItems: DropdownItem[]
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `deck-${deck.id}`,
    data: { type: 'deck', deckId: deck.id },
  })

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="w-full flex items-center gap-3 px-3 py-2 rounded-[var(--radius-sm)] hover:bg-[var(--bg-hover)] transition-colors text-left group"
    >
      {/* Drag handle */}
      <button
        {...listeners}
        {...attributes}
        className="cursor-grab active:cursor-grabbing text-[var(--text-muted)] hover:text-[var(--text-primary)] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
        onClick={(e) => e.stopPropagation()}
        aria-label="Drag to move deck"
      >
        <GripVertical size={13} />
      </button>

      {/* Clickable body */}
      <div className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer" onClick={onClick}>
        <BookOpen size={14} className="text-[var(--accent)] flex-shrink-0" />
        <span className="flex-1 text-sm text-[var(--text-primary)] truncate">{deck.name}</span>
        <span className="text-xs text-[var(--text-muted)]">{cardCount} cards</span>
        <span className="text-xs text-[var(--text-muted)]">{mastery}%</span>
        {dueCount > 0 && <Badge variant="accent">{dueCount} due</Badge>}
      </div>

      <a
        href={`/study/session?deck=${deck.id}`}
        onClick={(e) => e.stopPropagation()}
        className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-[10px] text-[var(--accent)] bg-[var(--accent-subtle)] px-1.5 py-0.5 rounded-full hover:bg-[var(--accent)] hover:text-white flex-shrink-0"
      >
        <Play size={9} /> Study
      </a>
      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        <ItemDropdown items={menuItems} />
      </div>
    </div>
  )
}
