'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useShallow } from 'zustand/react/shallow'
import { Plus, BookOpen, Pencil, Trash2, GripVertical, RotateCcw, Download, Eye } from 'lucide-react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Progress } from '@/components/ui/Progress'
import { Dialog } from '@/components/ui/Dialog'
import { CardEditor } from '@/components/library/CardEditor'
import { ReviewCard } from '@/components/study/ReviewCard'
import { useLibraryStore } from '@/store/useLibraryStore'
import { useSettingsStore } from '@/store/useSettingsStore'
import { useAppStore } from '@/store/useAppStore'
import { cn, truncate, formatDate } from '@/lib/utils'
import { fsrsRetrievability } from '@/lib/srs'
import type { FSRSState } from '@/lib/srs'
import { restoreCardsFromTrash, createUndoTracker } from '@/lib/deleteUndo'
import type { Card } from '@/lib/types'

const TYPE_LABELS: Record<string, string> = {
  basic: 'Basic',
  cloze: 'Cloze',
  typed: 'Typed',
  image: 'Image',
}

// ── Sortable card row ─────────────────────────────────────────────────────────

interface SortableCardRowProps {
  card: Card
  isDueCard: boolean
  fsrs?: FSRSState
  // Live retrievability percent to display — computed by the parent from
  // fsrsData. null when there's no meaningful value yet (new card).
  masteryPct: number | null
  selected?: boolean
  onEdit: (card: Card) => void
  onDelete: (id: string) => void
  onResetSRS: (id: string) => void
  onPreview: (card: Card) => void
  onClick?: () => void
  checked?: boolean
  onToggleCheck?: (id: string) => void
}

function fmtDate(iso: string) {
  return formatDate(iso)
}

function fmtRelative(iso: string | null) {
  if (!iso) return null
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return '1d ago'
  return `${days}d ago`
}

function fmtInterval(days: number): string {
  if (days < 1) {
    const minutes = Math.max(1, Math.round(days * 1440))
    return `${minutes} MIN${minutes === 1 ? '' : 'S'}`
  }
  const rounded = Math.round(days)
  return `${rounded} DAY${rounded === 1 ? '' : 'S'}`
}

// Current scheduled interval in days — FSRS stores due/last-reviewed
// timestamps rather than an interval field, so derive it.
function fsrsIntervalDays(fs: FSRSState): number | null {
  if (fs.state === 'new' || !fs.lastReviewedAt) return null
  return (new Date(fs.dueDate).getTime() - new Date(fs.lastReviewedAt).getTime()) / 86400000
}

function SortableCardRow({ card, isDueCard, fsrs, masteryPct, selected, onEdit, onDelete, onResetSRS, onPreview, onClick, checked, onToggleCheck }: SortableCardRowProps) {
  const [confirmReset, setConfirmReset] = useState(false)
  const cardFields = useSettingsStore((s) => s.cardFields)
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-sm)] border transition-colors group cursor-pointer',
        selected
          ? 'border-[var(--accent)] bg-[var(--accent-subtle)]'
          : 'border-transparent hover:border-[var(--border)] hover:bg-[var(--bg-hover)]',
        isDragging && 'z-10 shadow-lg bg-[var(--bg-hover)] border-[var(--border)]'
      )}
    >
      {/* Drag handle */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-grab active:cursor-grabbing touch-none"
        aria-label="Drag to reorder"
      >
        <GripVertical size={14} />
      </button>

      {onToggleCheck && (
        <input
          type="checkbox"
          checked={!!checked}
          onClick={(e) => e.stopPropagation()}
          onChange={() => onToggleCheck(card.id)}
          className="shrink-0 w-3.5 h-3.5 accent-[var(--accent)]"
          aria-label="Select card"
        />
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm text-[var(--text-primary)] truncate">{truncate(card.front, 60)}</span>
          <Badge variant="default">{TYPE_LABELS[card.type] ?? card.type}</Badge>
          {isDueCard && <Badge variant="accent">Due</Badge>}
        </div>
        <span className="text-xs text-[var(--text-muted)] truncate block">{truncate(card.back, 60)}</span>
        {Object.values(cardFields).some(Boolean) && (
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
            {cardFields.progress && (
              <span className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
                <span className="w-2.5 h-2.5 rounded-full border border-[var(--text-muted)] inline-block shrink-0" />
                {(() => {
                  const interval = fsrs ? fsrsIntervalDays(fsrs) : null
                  return interval !== null ? fmtInterval(interval) : 'NEW'
                })()}
              </span>
            )}
            {cardFields.retention && masteryPct !== null && (
              <span className="text-[11px] text-[var(--text-muted)]">↺ {masteryPct}%</span>
            )}
            {cardFields.lastReview && (
              <span className="text-[11px] text-[var(--text-muted)]">
                {fsrs?.lastReviewedAt ? `Reviewed ${fmtRelative(fsrs.lastReviewedAt)}` : 'Never reviewed'}
              </span>
            )}
            {cardFields.dueDate && fsrs && (
              <span className="text-[11px] text-[var(--text-muted)]">Due {fmtDate(fsrs.dueDate)}</span>
            )}
            {cardFields.tagsList && card.tags.length > 0 && (
              <span className="text-[11px] text-[var(--text-muted)]">{card.tags.map((t) => `#${t}`).join(' ')}</span>
            )}
            {cardFields.createdAt && (
              <span className="text-[11px] text-[var(--text-muted)]">Created {fmtDate(card.createdAt)}</span>
            )}
            {cardFields.updatedAt && (
              <span className="text-[11px] text-[var(--text-muted)]">Updated {fmtDate(card.updatedAt)}</span>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <Button
          variant="ghost"
          size="xs"
          onClick={(e) => { e.stopPropagation(); onPreview(card) }}
          className="w-6 px-0"
          title="Preview card"
        >
          <Eye size={11} />
        </Button>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => onEdit(card)}
          className="w-6 px-0"
        >
          <Pencil size={11} />
        </Button>
        {confirmReset ? (
          <span className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                onResetSRS(card.id)
                setConfirmReset(false)
              }}
              className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--warning-subtle,#2a2000)] text-[var(--warning,#f59e0b)] border border-[var(--warning,#f59e0b)] hover:opacity-80 transition-opacity"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={() => setConfirmReset(false)}
              className="text-[10px] px-1 py-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
            >
              Cancel
            </button>
          </span>
        ) : (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setConfirmReset(true)}
            className="w-6 px-0 text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            title="Reset SRS progress (card stays in deck)"
          >
            <RotateCcw size={11} />
          </Button>
        )}
        <Button
          variant="ghost"
          size="xs"
          onClick={() => onDelete(card.id)}
          className="w-6 px-0 text-[var(--danger)] hover:bg-[var(--danger-subtle)]"
        >
          <Trash2 size={11} />
        </Button>
      </div>
    </div>
  )
}

// ── DeckView ──────────────────────────────────────────────────────────────────

interface DeckViewProps {
  deckId: string
  onStudy?: () => void
}

export function DeckView({ deckId, onStudy }: DeckViewProps) {
  const router = useRouter()
  const {
    decks, allCards, fsrsData,
    getDeckCards, getDeckMastery, deleteCard, deleteCardsBatch, updateCardsBatch, resetCardSRS,
  } = useLibraryStore(
    useShallow((s) => ({
      decks: s.decks,
      allCards: s.cards,
      fsrsData: s.fsrsData,
      getDeckCards: s.getDeckCards,
      getDeckMastery: s.getDeckMastery,
      deleteCard: s.deleteCard,
      deleteCardsBatch: s.deleteCardsBatch,
      updateCardsBatch: s.updateCardsBatch,
      resetCardSRS: s.resetCardSRS,
    }))
  )
  const deck = decks.find((d) => d.id === deckId)
  const cards = useMemo(() => getDeckCards(deckId), [allCards, deckId, getDeckCards])
  const mastery = useMemo(
    () => getDeckMastery(deckId),
    [allCards, fsrsData, deckId, getDeckMastery]
  )

  const [addingCard, setAddingCard] = useState(false)
  const [editingCard, setEditingCard] = useState<Card | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [selectedIdx, setSelectedIdx] = useState<number>(-1)
  const [previewCard, setPreviewCard] = useState<Card | null>(null)
  const [previewShowAnswer, setPreviewShowAnswer] = useState(false)

  // Bulk selection — Cmd/Ctrl+A selects all, checkboxes toggle individual cards
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showBulkMove, setShowBulkMove] = useState(false)
  const [showBulkTag, setShowBulkTag] = useState(false)
  const [showBulkDelete, setShowBulkDelete] = useState(false)
  const [bulkMoveTarget, setBulkMoveTarget] = useState('')
  const [bulkTagInput, setBulkTagInput] = useState('')

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Tracks the most recent trash-via-delete (single or bulk) so Ctrl+Z can
  // restore the card(s) to their original deck within the undo window.
  const undoTrackerRef = useRef(createUndoTracker<string[]>())

  function trackDeleteForUndo(ids: string[]) {
    undoTrackerRef.current.track(ids)
    useAppStore.getState().addToast({
      type: 'info',
      message: ids.length === 1 ? 'Card deleted — Undo?' : `${ids.length} cards deleted — Undo?`,
      duration: 5000,
      action: { label: 'Undo', onClick: () => handleUndoDelete() },
    })
  }

  function handleUndoDelete() {
    const ids = undoTrackerRef.current.consume()
    if (!ids) return
    restoreCardsFromTrash(ids)
    useAppStore.getState().addToast({
      type: 'info',
      message: ids.length === 1 ? 'Card restored' : 'Cards restored',
      duration: 2000,
    })
  }

  function handleBulkMove() {
    if (!bulkMoveTarget) return
    updateCardsBatch(Array.from(selectedIds).map((id) => ({ id, updates: { deckId: bulkMoveTarget } })))
    setSelectedIds(new Set())
    setShowBulkMove(false)
    setBulkMoveTarget('')
  }

  function handleBulkTag() {
    const tag = bulkTagInput.trim().toLowerCase()
    if (!tag) return
    const updates = Array.from(selectedIds)
      .map((id) => cards.find((c) => c.id === id))
      .filter((card): card is Card => !!card && !card.tags.includes(tag))
      .map((card) => ({ id: card.id, updates: { tags: [...card.tags, tag] } }))
    updateCardsBatch(updates)
    setSelectedIds(new Set())
    setShowBulkTag(false)
    setBulkTagInput('')
  }

  function handleBulkDelete() {
    const ids = Array.from(selectedIds)
    deleteCardsBatch(ids)
    trackDeleteForUndo(ids)
    setSelectedIds(new Set())
    setShowBulkDelete(false)
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = cards.findIndex((c) => c.id === active.id)
    const newIndex = cards.findIndex((c) => c.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const reordered = arrayMove(cards, oldIndex, newIndex)
    updateCardsBatch(reordered.map((card, index) => ({ id: card.id, updates: { order: index * 10 } })))
  }

  const anyDialogOpen = addingCard || !!editingCard || !!confirmDeleteId || !!previewCard
    || showBulkMove || showBulkTag || showBulkDelete

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (anyDialogOpen) return
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

      if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault()
        setSelectedIds(new Set(cards.map((c) => c.id)))
        return
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault()
        handleUndoDelete()
        return
      }

      if (e.key === 'Escape') { setSelectedIdx(-1); setSelectedIds(new Set()); return }

      if (e.key === 'n' || e.key === 'N') { setAddingCard(true); return }

      if (e.key === 'r' || e.key === 'R') {
        router.push(`/study/session?deck=${deckId}&mode=deck-all`)
        return
      }

      if ((e.key === 'ArrowDown' || e.key === 'j') && cards.length > 0) {
        e.preventDefault()
        setSelectedIdx((i) => Math.min(i + 1, cards.length - 1))
        return
      }
      if ((e.key === 'ArrowUp' || e.key === 'k') && cards.length > 0) {
        e.preventDefault()
        setSelectedIdx((i) => Math.max(i - 1, 0))
        return
      }

      const selected = selectedIdx >= 0 ? cards[selectedIdx] : null
      if (!selected) return

      if (e.key === 'e' || e.key === 'E') { setEditingCard(selected); return }
      if (e.key === 'd' || e.key === 'D') { setConfirmDeleteId(selected.id); return }
      if (e.code === 'Space') { e.preventDefault(); setEditingCard(selected); return }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [anyDialogOpen, cards, selectedIdx, deckId, router])

  if (!deck) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-[var(--text-muted)] text-sm">
        Deck not found.
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-[var(--border)]">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <BookOpen size={16} className="text-[var(--accent)] shrink-0" />
              <h2 className="text-base font-semibold text-[var(--text-primary)] truncate">{deck.name}</h2>
            </div>
            {deck.description && (
              <p className="text-xs text-[var(--text-muted)] ml-6">{deck.description}</p>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            <Button variant="ghost" size="sm" icon={<Download size={13} />} onClick={() => router.push(`/import?deckId=${deckId}`)}>
              Import
            </Button>
            <Button variant="ghost" size="sm" icon={<Plus size={13} />} onClick={() => setAddingCard(true)}>
              Add Card
            </Button>
            {onStudy && (
              <Button
                variant="primary"
                size="sm"
                onClick={onStudy}
                disabled={cards.length === 0}
                title="Study every card in this deck, regardless of due date"
              >
                Study all ({cards.length})
              </Button>
            )}
          </div>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-4 ml-6">
          <span className="text-xs text-[var(--text-muted)]">
            <span className="text-[var(--text-primary)] font-medium">{cards.length}</span> cards
          </span>
          <div className="flex-1 flex items-center gap-2 max-w-[160px]">
            <Progress value={mastery} size="sm" color={mastery >= 70 ? 'success' : mastery >= 40 ? 'accent' : 'warning'} />
            <span className="text-xs text-[var(--text-muted)] shrink-0">{mastery}%</span>
          </div>
        </div>
      </div>

      {/* Bulk selection toolbar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 px-5 py-2 border-b border-[var(--border)] bg-[var(--accent-subtle)]">
          <span className="text-xs font-medium text-[var(--accent)]">
            {selectedIds.size} selected
          </span>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={() => setShowBulkMove(true)}>
            Move to deck
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShowBulkTag(true)}>
            Add tag
          </Button>
          <Button variant="ghost" size="sm" className="text-[var(--danger)]" onClick={() => setShowBulkDelete(true)}>
            <Trash2 size={12} />
            Trash
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {/* Card list */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {cards.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <div className="w-10 h-10 rounded-full bg-[var(--bg-active)] flex items-center justify-center">
              <BookOpen size={18} className="text-[var(--text-muted)]" />
            </div>
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">No cards yet</p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">Add your first card to start studying.</p>
            </div>
            <Button variant="primary" size="sm" icon={<Plus size={13} />} onClick={() => setAddingCard(true)}>
              Add Card
            </Button>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-1">
                {cards.map((card, idx) => {
                  const fs = fsrsData[card.id]
                  const due = fs ? new Date(fs.dueDate) <= new Date() : true
                  const masteryPct = fs && fs.state !== 'new'
                    ? Math.round(fsrsRetrievability(fs) * 100)
                    : null
                  return (
                    <SortableCardRow
                      key={card.id}
                      card={card}
                      isDueCard={due}
                      fsrs={fs}
                      masteryPct={masteryPct}
                      selected={selectedIdx === idx}
                      onEdit={setEditingCard}
                      onDelete={setConfirmDeleteId}
                      onResetSRS={(id) => resetCardSRS(id)}
                      onPreview={(c) => { setPreviewShowAnswer(false); setPreviewCard(c) }}
                      onClick={() => setSelectedIdx(idx === selectedIdx ? -1 : idx)}
                      checked={selectedIds.has(card.id)}
                      onToggleCheck={toggleSelect}
                    />
                  )
                })}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Add card dialog */}
      <Dialog
        open={addingCard}
        onClose={() => setAddingCard(false)}
        title="Add Card"
        size="lg"
      >
        <div className="p-4">
          <CardEditor
            deckId={deckId}
            onDone={() => setAddingCard(false)}
          />
        </div>
      </Dialog>

      {/* Edit card dialog */}
      <Dialog
        open={!!editingCard}
        onClose={() => setEditingCard(null)}
        title="Edit Card"
        size="lg"
      >
        <div className="p-4">
          {editingCard && (
            <CardEditor
              deckId={deckId}
              card={editingCard}
              onDone={() => setEditingCard(null)}
            />
          )}
        </div>
      </Dialog>

      {/* Preview card dialog — a quick peek, not a study session */}
      <Dialog
        open={!!previewCard}
        onClose={() => setPreviewCard(null)}
        title="Preview Card"
        size="lg"
      >
        <div className="p-4">
          {previewCard && (
            <div
              className="rounded-xl overflow-hidden"
              style={{ background: 'var(--bg-base)', border: '1px solid var(--border)' }}
            >
              <ReviewCard card={previewCard} showAnswer={previewShowAnswer} onTypedCheck={() => setPreviewShowAnswer(true)} />
              {!previewShowAnswer && previewCard.type !== 'typed' && previewCard.type !== 'cloze' && (
                <button
                  onClick={() => setPreviewShowAnswer(true)}
                  className="w-full flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors border-t hover:brightness-110 select-none"
                  style={{ background: 'var(--bg-hover)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                >
                  Show Answer
                </button>
              )}
            </div>
          )}
        </div>
      </Dialog>

      {/* Confirm delete dialog */}
      <Dialog
        open={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        title="Delete card?"
        description="This will permanently remove the card and its SRS progress."
        size="sm"
      >
        <div className="p-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setConfirmDeleteId(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              if (confirmDeleteId) {
                deleteCard(confirmDeleteId)
                trackDeleteForUndo([confirmDeleteId])
              }
              setConfirmDeleteId(null)
            }}
          >
            Delete
          </Button>
        </div>
      </Dialog>

      {/* Bulk: move selected cards to another deck */}
      <Dialog
        open={showBulkMove}
        onClose={() => setShowBulkMove(false)}
        title={`Move ${selectedIds.size} ${selectedIds.size === 1 ? 'card' : 'cards'}`}
        size="sm"
      >
        <div className="p-4 space-y-3">
          <select
            value={bulkMoveTarget}
            onChange={(e) => setBulkMoveTarget(e.target.value)}
            className="w-full text-sm bg-[var(--bg-hover)] border border-[var(--border)] rounded-[var(--radius-sm)] px-3 py-2 text-[var(--text-primary)] outline-none"
          >
            <option value="">Choose a deck…</option>
            {decks.filter((d) => d.id !== deckId).map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowBulkMove(false)}>Cancel</Button>
            <Button variant="primary" size="sm" disabled={!bulkMoveTarget} onClick={handleBulkMove}>Move</Button>
          </div>
        </div>
      </Dialog>

      {/* Bulk: add a tag to selected cards */}
      <Dialog
        open={showBulkTag}
        onClose={() => setShowBulkTag(false)}
        title={`Tag ${selectedIds.size} ${selectedIds.size === 1 ? 'card' : 'cards'}`}
        size="sm"
      >
        <div className="p-4 space-y-3">
          <input
            autoFocus
            value={bulkTagInput}
            onChange={(e) => setBulkTagInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleBulkTag() }}
            placeholder="Tag name…"
            className="w-full text-sm bg-[var(--bg-hover)] border border-[var(--border)] rounded-[var(--radius-sm)] px-3 py-2 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowBulkTag(false)}>Cancel</Button>
            <Button variant="primary" size="sm" disabled={!bulkTagInput.trim()} onClick={handleBulkTag}>Add tag</Button>
          </div>
        </div>
      </Dialog>

      {/* Bulk: send selected cards to trash */}
      <Dialog
        open={showBulkDelete}
        onClose={() => setShowBulkDelete(false)}
        title="Delete cards?"
        size="sm"
      >
        <div className="p-4 space-y-3">
          <p className="text-sm text-[var(--text-primary)]">
            This will delete <strong>{selectedIds.size}</strong>{' '}
            {selectedIds.size === 1 ? 'card' : 'cards'}. You can undo with Ctrl+Z for a few seconds after.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowBulkDelete(false)}>Cancel</Button>
            <Button variant="danger" size="sm" onClick={handleBulkDelete}>Delete</Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}
