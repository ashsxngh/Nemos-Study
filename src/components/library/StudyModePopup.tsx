'use client'

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

  function countFor(mode: DeckStudyMode, deckId: string): number {
    const lib = useLibraryStore.getState()
    if (mode === 'deck-reviews') return lib.getDeckReviewsAll(deckId).length
    if (mode === 'deck-new') return lib.getDeckNewAll(deckId).length
    return lib.getDeckBoth(deckId).length
  }

  function handleSelect(mode: DeckStudyMode) {
    if (!deck) return
    if (countFor(mode, deck.id) === 0) {
      const label = mode === 'deck-reviews' ? 'reviews due' : mode === 'deck-new' ? 'new cards' : 'cards'
      useAppStore.getState().addToast({ type: 'info', message: `No ${label} in this deck right now.`, duration: 2500 })
      return
    }
    onClose()
    router.push(`/study/session?deck=${deck.id}&mode=${mode}`)
  }

  return (
    <Dialog open={!!deck} onClose={onClose} title={deck?.name} size="sm">
      <div className="p-3 flex flex-col gap-1.5">
        {MODES.map(({ mode, label, description, icon }) => (
          <button
            key={mode}
            onClick={() => handleSelect(mode)}
            className="w-full flex items-start gap-2.5 px-3 py-2.5 rounded-lg text-left transition-colors hover:bg-[var(--bg-hover)]"
            style={{ border: '1px solid var(--border)' }}
          >
            <span className="mt-0.5 text-[var(--accent)]">{icon}</span>
            <span>
              <span className="block text-sm font-medium text-[var(--text-primary)]">{label}</span>
              <span className="block text-xs text-[var(--text-muted)] mt-0.5">{description}</span>
            </span>
          </button>
        ))}
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
