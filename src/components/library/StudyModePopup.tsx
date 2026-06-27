'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { History, Sparkles, Shuffle } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { useLibraryStore } from '@/store/useLibraryStore'
import { useAppStore } from '@/store/useAppStore'
import type { Deck } from '@/lib/types'

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

export function StudyModePopup({ deck, onClose }: StudyModePopupProps) {
  const router = useRouter()
  const [selectedMode, setSelectedMode] = useState<DeckStudyMode | null>(null)
  const [newCount, setNewCount] = useState(0)
  const [availableNew, setAvailableNew] = useState(0)

  useEffect(() => {
    setSelectedMode(null)
    setNewCount(0)
    setAvailableNew(0)
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
    const avail = useLibraryStore.getState().getDeckNewAll(deck.id).length
    // Reviews always navigate immediately; modes with no new cards also navigate immediately
    if (mode === 'deck-reviews' || avail === 0) {
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
    const count = Math.min(Math.max(1, newCount), availableNew)
    onClose()
    router.push(`/study/session?deck=${deck.id}&mode=${selectedMode}&newCount=${count}`)
  }

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

        {selectedMode && (
          <button
            onClick={handleStart}
            className="w-full mt-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors hover:opacity-90"
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
