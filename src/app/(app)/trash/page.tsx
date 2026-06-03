'use client'

import { useEffect, useState } from 'react'
import { Trash2, RotateCcw, X, BookOpen, FileText, CreditCard, AlertTriangle } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/Button'
import { useTrashStore, type TrashEntry } from '@/store/useTrashStore'
import { useLibraryStore } from '@/store/useLibraryStore'
import { useNotesStore } from '@/store/useNotesStore'
import { cn } from '@/lib/utils'

const TRASH_TTL_DAYS = 14

function daysRemaining(deletedAt: string): number {
  const elapsed = Date.now() - new Date(deletedAt).getTime()
  const elapsedDays = elapsed / (1000 * 60 * 60 * 24)
  return Math.max(0, Math.ceil(TRASH_TTL_DAYS - elapsedDays))
}

function formatDeletedDate(deletedAt: string): string {
  const d = new Date(deletedAt)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function TypeIcon({ type }: { type: TrashEntry['type'] }) {
  if (type === 'deck') return <BookOpen size={14} className="text-[var(--accent)] shrink-0" />
  if (type === 'note') return <FileText size={14} className="text-yellow-400 shrink-0" />
  return <CreditCard size={14} className="text-[var(--text-muted)] shrink-0" />
}

function TypeBadge({ type }: { type: TrashEntry['type'] }) {
  const map = {
    card: 'bg-[var(--bg-active)] text-[var(--text-muted)]',
    deck: 'bg-[var(--accent-subtle)] text-[var(--accent)]',
    note: 'bg-yellow-950/40 text-yellow-400',
  }
  return (
    <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded', map[type])}>
      {type}
    </span>
  )
}

interface TrashItemRowProps {
  entry: TrashEntry
  onRestore: () => void
  onDelete: () => void
}

function TrashItemRow({ entry, onRestore, onDelete }: TrashItemRowProps) {
  const days = daysRemaining(entry.deletedAt)
  const urgent = days <= 3

  return (
    <div className="flex items-start gap-3 px-4 py-3 hover:bg-[var(--bg-hover)] transition-colors group">
      <TypeIcon type={entry.type} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-medium text-[var(--text-primary)] truncate">
            {entry.name}
          </span>
          <TypeBadge type={entry.type} />
          {entry.cardCount !== undefined && (
            <span className="text-[10px] text-[var(--text-muted)]">{entry.cardCount} cards</span>
          )}
        </div>
        {entry.parentName && (
          <p className="text-xs text-[var(--text-muted)] mb-0.5">in {entry.parentName}</p>
        )}
        {entry.snippet && (
          <p className="text-xs text-[var(--text-muted)] truncate opacity-70">{entry.snippet}</p>
        )}
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[10px] text-[var(--text-muted)]">
            Deleted {formatDeletedDate(entry.deletedAt)}
          </span>
          <span className={cn(
            'text-[10px] font-medium',
            urgent ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]'
          )}>
            {urgent && <span className="mr-0.5">⚠</span>}
            {days === 0 ? 'Expires today' : `${days}d remaining`}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <button
          onClick={onRestore}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-active)] transition-colors"
          title="Restore"
        >
          <RotateCcw size={12} />
          Restore
        </button>
        <button
          onClick={onDelete}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded-[var(--radius-sm)] text-[var(--danger)] hover:bg-[var(--danger-subtle)] transition-colors"
          title="Delete forever"
        >
          <X size={12} />
          Delete forever
        </button>
      </div>
    </div>
  )
}

export default function TrashPage() {
  const { items, remove, purgeExpired, clear } = useTrashStore()
  const [confirmClear, setConfirmClear] = useState(false)

  // Purge expired items on mount
  useEffect(() => {
    purgeExpired()
  }, [purgeExpired])

  function handleRestore(entry: TrashEntry) {
    if (entry.type === 'card' && entry.card) {
      useLibraryStore.setState((s) => ({
        cards: [...s.cards, entry.card!],
        srsData: entry.cardSRS ? { ...s.srsData, [entry.card!.id]: entry.cardSRS } : s.srsData,
        fsrsData: entry.cardFSRS ? { ...s.fsrsData, [entry.card!.id]: entry.cardFSRS } : s.fsrsData,
        // Remove from pendingDeletes in case it was queued for Supabase DELETE
        pendingDeletes: {
          ...s.pendingDeletes,
          cards: s.pendingDeletes.cards.filter((id) => id !== entry.card!.id),
        },
      }))
    } else if (entry.type === 'deck' && entry.deck) {
      useLibraryStore.setState((s) => ({
        decks: [...s.decks, entry.deck!],
        cards: [...s.cards, ...(entry.deckCards ?? [])],
        srsData: { ...s.srsData, ...(entry.deckSRS ?? {}) },
        fsrsData: { ...s.fsrsData, ...(entry.deckFSRS ?? {}) },
        pendingDeletes: {
          ...s.pendingDeletes,
          decks: s.pendingDeletes.decks.filter((id) => id !== entry.deck!.id),
          cards: s.pendingDeletes.cards.filter(
            (id) => !(entry.deckCards ?? []).some((c) => c.id === id)
          ),
        },
      }))
    } else if (entry.type === 'note' && entry.note) {
      useNotesStore.setState((s) => ({
        notes: [...s.notes, entry.note!],
      }))
    }
    remove(entry.id)
  }

  const cards = items.filter((i) => i.type === 'card')
  const decks = items.filter((i) => i.type === 'deck')
  const notes = items.filter((i) => i.type === 'note')

  const sections = [
    { label: 'Decks', items: decks, icon: <BookOpen size={14} /> },
    { label: 'Cards', items: cards, icon: <CreditCard size={14} /> },
    { label: 'Notes', items: notes, icon: <FileText size={14} /> },
  ].filter((s) => s.items.length > 0)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title="Recently Deleted"
        actions={
          items.length > 0 ? (
            confirmClear ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--text-muted)]">Delete all {items.length} items?</span>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => { clear(); setConfirmClear(false) }}
                >
                  Yes, clear all
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmClear(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                icon={<Trash2 size={13} />}
                onClick={() => setConfirmClear(true)}
              >
                Clear all
              </Button>
            )
          ) : undefined
        }
      />

      <main className="flex-1 overflow-y-auto p-5">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
            <div className="w-10 h-10 rounded-full bg-[var(--bg-active)] flex items-center justify-center">
              <Trash2 size={18} className="text-[var(--text-muted)]" />
            </div>
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">Trash is empty</p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Deleted cards, decks and notes appear here for {TRASH_TTL_DAYS} days.
              </p>
            </div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-6">
            {/* Info banner */}
            <div className="flex items-start gap-2.5 p-3 rounded-[var(--radius)] bg-[var(--bg-surface)] border border-[var(--border)] text-xs text-[var(--text-muted)]">
              <AlertTriangle size={13} className="shrink-0 mt-0.5 text-[var(--warning)]" />
              <span>
                Items are automatically deleted after {TRASH_TTL_DAYS} days.
                Restore them to put them back in your library.
              </span>
            </div>

            {sections.map(({ label, items: sectionItems, icon }) => (
              <section key={label}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[var(--text-muted)]">{icon}</span>
                  <h2 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-widest">
                    {label}
                  </h2>
                  <span className="text-xs text-[var(--text-muted)]">({sectionItems.length})</span>
                </div>
                <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] divide-y divide-[var(--border)] overflow-hidden">
                  {sectionItems.map((entry) => (
                    <TrashItemRow
                      key={entry.id}
                      entry={entry}
                      onRestore={() => handleRestore(entry)}
                      onDelete={() => remove(entry.id)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
