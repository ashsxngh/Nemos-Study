'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, BookOpen, Pencil, Trash2, GripVertical, RotateCcw, Download } from 'lucide-react'
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
import { useLibraryStore } from '@/store/useLibraryStore'
import { useSettingsStore } from '@/store/useSettingsStore'
import { cn, truncate } from '@/lib/utils'
import { isDue } from '@/lib/srs'
import type { Card, SRSData } from '@/lib/types'

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
  srs?: SRSData
  selected?: boolean
  onEdit: (card: Card) => void
  onDelete: (id: string) => void
  onResetSRS: (id: string) => void
  onClick?: () => void
}

function fmtDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtRelative(iso: string | null) {
  if (!iso) return null
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return '1d ago'
  return `${days}d ago`
}

function SortableCardRow({ card, isDueCard, srs, selected, onEdit, onDelete, onResetSRS, onClick }: SortableCardRowProps) {
  const [confirmReset, setConfirmReset] = useState(false)
  const { cardFields } = useSettingsStore()
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
                {srs ? `${srs.interval} DAY${srs.interval === 1 ? '' : 'S'}` : 'NEW'}
              </span>
            )}
            {cardFields.retention && srs && (
              <span className="text-[11px] text-[var(--text-muted)]">↺ {srs.masteryPercent}%</span>
            )}
            {cardFields.lastReview && (
              <span className="text-[11px] text-[var(--text-muted)]">
                {srs?.lastReviewedAt ? `Reviewed ${fmtRelative(srs.lastReviewedAt)}` : 'Never reviewed'}
              </span>
            )}
            {cardFields.dueDate && srs && (
              <span className="text-[11px] text-[var(--text-muted)]">Due {fmtDate(srs.dueDate)}</span>
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
  const { decks, getDeckCards, getDeckMastery, getDueCards, deleteCard, updateCard, resetCardSRS } = useLibraryStore()
  const deck = decks.find((d) => d.id === deckId)
  const cards = getDeckCards(deckId)
  const mastery = getDeckMastery(deckId)
  const dueCount = getDueCards(deckId).length
  const srsData = useLibraryStore((s) => s.srsData)

  const [addingCard, setAddingCard] = useState(false)
  const [editingCard, setEditingCard] = useState<Card | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [selectedIdx, setSelectedIdx] = useState<number>(-1)

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
    reordered.forEach((card, index) => {
      updateCard(card.id, { order: index * 10 })
    })
  }

  const anyDialogOpen = addingCard || !!editingCard || !!confirmDeleteId

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (anyDialogOpen) return
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

      if (e.key === 'Escape') { setSelectedIdx(-1); return }

      if (e.key === 'n' || e.key === 'N') { setAddingCard(true); return }

      if (e.key === 'r' || e.key === 'R') {
        router.push(`/study/session?deck=${deckId}`)
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
              <Button variant="primary" size="sm" onClick={onStudy} disabled={cards.length === 0}>
                Study {dueCount > 0 ? `(${dueCount} due)` : ''}
              </Button>
            )}
          </div>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-4 ml-6">
          <span className="text-xs text-[var(--text-muted)]">
            <span className="text-[var(--text-primary)] font-medium">{cards.length}</span> cards
          </span>
          {dueCount > 0 && (
            <Badge variant="accent">{dueCount} due</Badge>
          )}
          <div className="flex-1 flex items-center gap-2 max-w-[160px]">
            <Progress value={mastery} size="sm" color={mastery >= 70 ? 'success' : mastery >= 40 ? 'accent' : 'warning'} />
            <span className="text-xs text-[var(--text-muted)] shrink-0">{mastery}%</span>
          </div>
        </div>
      </div>

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
                  const srs = srsData[card.id]
                  const due = srs ? isDue(srs) : true
                  return (
                    <SortableCardRow
                      key={card.id}
                      card={card}
                      isDueCard={due}
                      srs={srs}
                      selected={selectedIdx === idx}
                      onEdit={setEditingCard}
                      onDelete={setConfirmDeleteId}
                      onResetSRS={(id) => resetCardSRS(id)}
                      onClick={() => setSelectedIdx(idx === selectedIdx ? -1 : idx)}
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
              if (confirmDeleteId) deleteCard(confirmDeleteId)
              setConfirmDeleteId(null)
            }}
          >
            Delete
          </Button>
        </div>
      </Dialog>
    </div>
  )
}
