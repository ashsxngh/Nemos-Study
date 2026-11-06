'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { History, Sparkles, Shuffle } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { useLibraryStore } from '@/store/useLibraryStore'
import { useAppStore } from '@/store/useAppStore'
import type { Deck, PracticeOrder } from '@/lib/types'

type DeckStudyMode = 'deck-reviews' | 'deck-new' | 'deck-both'

interface StudyModePopupProps {
  deck: Deck | null
  onClose: () => void
}

const MODES: { mode: DeckStudyMode; label: string; description: string; icon: React.ReactNode }[] = [
  {
    mode: 'deck-reviews',
    label: 'Reviews',
    description: 'Previously learned cards, regardless of due date',
    icon: <History size={14} />,
  },
  {
    mode: 'deck-new',
    label: 'New Cards',
    description: 'All new cards from this deck',
    icon: <Sparkles size={14} />,
  },
  {
    mode: 'deck-both',
    label: 'Both',
    description: 'Interleave reviews and new cards',
    icon: <Shuffle size={14} />,
  },
]

const REVIEW_ORDERS: { order: PracticeOrder; label: string; title: string }[] = [
  { order: 'random', label: 'Random', title: 'A random selection' },
  { order: 'hardest', label: 'Hardest', title: 'Lowest recall probability right now first' },
  { order: 'last-seen', label: 'Last seen', title: 'Longest since last review first' },
]

export function StudyModePopup({ deck, onClose }: StudyModePopupProps) {
  const router = useRouter()
  const [selectedMode, setSelectedMode] = useState<DeckStudyMode | null>(null)
  const [newCount, setNewCount] = useState(0)
  const [availableNew, setAvailableNew] = useState(0)
  // Reviews count is kept as typed text so the field can be cleared; an empty
  // or 0 value disables Start rather than silently snapping back to 1.
  const [reviewCount, setReviewCount] = useState('')
  const [availableReviews, setAvailableReviews] = useState(0)
  const [reviewOrder, setReviewOrder] = useState<PracticeOrder>('random')

  useEffect(() => {
    setSelectedMode(null)
    setNewCount(0)
    setAvailableNew(0)
    setReviewCount('')
    setAvailableReviews(0)
    setReviewOrder('random')
  }, [deck?.id])

  function countFor(mode: DeckStudyMode, deckId: string): number {
    const lib = useLibraryStore.getState()
    if (mode === 'deck-reviews') return lib.getDeckReviewsAll(deckId).length
    if (mode === 'deck-new') return lib.getDeckNewAll(deckId).length
    return lib.getDeckBoth(deckId).length
  }

  function handleModeClick(mode: DeckStudyMode) {
    if (!deck) return
    if (countFor(mode, deck.id) === 0) {
      const label = mode === 'deck-reviews' ? 'reviews due' : mode === 'deck-new' ? 'new cards' : 'cards'
      useAppStore.getState().addToast({ type: 'info', message: `No ${label} in this deck right now.`, duration: 2500 })
      return
    }
    if (mode === 'deck-reviews') {
      // Pool = every learned card in the deck, regardless of due date.
      const learned = useLibraryStore.getState().getDeckReviewsAll(deck.id).length
      setSelectedMode(mode)
      setAvailableReviews(learned)
      setReviewCount(String(learned))
      return
    }
    const avail = useLibraryStore.getState().getDeckNewAll(deck.id).length
    // Modes with no new cards navigate immediately
    if (avail === 0) {
      onClose()
      router.push(`/study/session?deck=${deck.id}&mode=${mode}`)
      return
    }
    setSelectedMode(mode)
    setAvailableNew(avail)
    setNewCount(avail)
  }

  function handleStart() {
    if (!deck || !selectedMode) return
    if (selectedMode === 'deck-reviews') {
      if (!reviewCountValid) return
      onClose()
      router.push(`/study/session?deck=${deck.id}&mode=deck-reviews&reviewCount=${parsedReviewCount}&order=${reviewOrder}`)
      return
    }
    const count = Math.min(Math.max(1, newCount), availableNew)
    onClose()
    router.push(`/study/session?deck=${deck.id}&mode=${selectedMode}&newCount=${count}`)
  }

  const parsedReviewCount = parseInt(reviewCount, 10)
  const reviewCountValid =
    Number.isInteger(parsedReviewCount) && parsedReviewCount >= 1 && parsedReviewCount <= availableReviews
  const startDisabled = selectedMode === 'deck-reviews' && !reviewCountValid

  const showInput = (selectedMode === 'deck-new' || selectedMode === 'deck-both') && availableNew > 0

  return (
    <Dialog open={!!deck} onClose={onClose} title={deck?.name} size="sm">
      <div className="p-3 flex flex-col gap-1.5">
        {MODES.map(({ mode, label, description, icon }) => (
          <button
            key={mode}
            onClick={() => handleModeClick(mode)}
            className="w-full flex items-start gap-2.5 px-3 py-2.5 rounded-lg text-left transition-colors hover:bg-[var(--bg-hover)]"
            style={{ border: selectedMode === mode ? '1px solid var(--accent)' : '1px solid var(--border)' }}
          >
            <span className="mt-0.5 text-[var(--accent)]">{icon}</span>
            <span>
              <span className="block text-sm font-medium text-[var(--text-primary)]">{label}</span>
              <span className="block text-xs text-[var(--text-muted)] mt-0.5">{description}</span>
            </span>
          </button>
        ))}

        {showInput && (
          <div className="mt-0.5 px-3 py-2.5 rounded-lg" style={{ border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-[var(--text-muted)]">New cards this session</span>
              <input
                type="number"
                min={1}
                value={newCount}
                onChange={(e) => setNewCount(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-16 text-center text-sm font-medium rounded-md px-2 py-1 bg-[var(--bg-primary)] text-[var(--text-primary)]"
                style={{ border: '1px solid var(--border)' }}
              />
            </div>
            {newCount > availableNew && (
              <p className="text-xs text-[var(--text-muted)] mt-1.5">
                Only {availableNew} new card{availableNew !== 1 ? 's' : ''} available in this deck
              </p>
            )}
          </div>
        )}

        {selectedMode === 'deck-reviews' && availableReviews > 0 && (
          <div className="mt-0.5 px-3 py-2.5 rounded-lg" style={{ border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-[var(--text-muted)]">Reviews this session</span>
              <input
                type="number"
                min={1}
                max={availableReviews}
                value={reviewCount}
                onChange={(e) => {
                  const raw = e.target.value
                  const n = parseInt(raw, 10)
                  // Can't exceed the learned cards actually in this deck.
                  setReviewCount(!isNaN(n) && n > availableReviews ? String(availableReviews) : raw)
                }}
                className="w-16 text-center text-sm font-medium rounded-md px-2 py-1 bg-[var(--bg-primary)] text-[var(--text-primary)]"
                style={{ border: '1px solid var(--border)' }}
              />
            </div>
            <div className="flex items-center justify-between gap-3 mt-2">
              <span className="text-xs text-[var(--text-muted)]">Order</span>
              <div className="flex gap-1">
                {REVIEW_ORDERS.map(({ order, label, title }) => (
                  <button
                    key={order}
                    type="button"
                    onClick={() => setReviewOrder(order)}
                    title={title}
                    className="text-xs font-medium rounded-md px-2 py-1 transition-colors hover:bg-[var(--bg-hover)]"
                    style={{
                      border: reviewOrder === order ? '1px solid var(--accent)' : '1px solid var(--border)',
                      color: reviewOrder === order ? 'var(--text-primary)' : 'var(--text-muted)',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-1.5">
              Practice only, doesn&apos;t change your review schedule
            </p>
          </div>
        )}

        {selectedMode && (
          <button
            onClick={handleStart}
            disabled={startDisabled}
            className="w-full mt-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'var(--accent)', color: 'white' }}
          >
            Start
          </button>
        )}

        <button
          onClick={onClose}
          className="w-full mt-1 px-3 py-2 rounded-lg text-xs font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)]"
        >
          Cancel
        </button>
      </div>
    </Dialog>
  )
}
