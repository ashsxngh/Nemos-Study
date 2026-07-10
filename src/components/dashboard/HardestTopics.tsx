'use client'

import { useMemo } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { Progress } from '@/components/ui/Progress'
import { useLibraryStore } from '@/store/useLibraryStore'

export function HardestTopics() {
  const { decks, cards, fsrsData, getDeckMastery } = useLibraryStore(
    useShallow((s) => ({
      decks: s.decks,
      cards: s.cards,
      fsrsData: s.fsrsData,
      getDeckMastery: s.getDeckMastery,
    }))
  )

  const ranked = useMemo(() => {
    return decks
      .filter((d) => !d.isArchived)
      .map((deck) => {
        const deckCards = cards.filter((c) => c.deckId === deck.id)
        // A deck nobody has started yet isn't "hard" — it just has no
        // evidence either way, and getDeckMastery would rank it as 0%
        // (indistinguishable from a deck that's actually being failed).
        const reviewedCount = deckCards.filter((c) => {
          const state = fsrsData[c.id]?.state
          return state === 'review' || state === 'relearning'
        }).length
        return { deck, mastery: getDeckMastery(deck.id), reviewedCount }
      })
      .filter((d) => d.reviewedCount > 0)
      .sort((a, b) => a.mastery - b.mastery)
      .slice(0, 5)
  }, [decks, cards, fsrsData, getDeckMastery])

  return (
    <div className="card-surface p-8">
      <div className="flex items-center justify-between mb-6">
        <h2 className="meta-label text-[var(--text-secondary)]">Focus Areas</h2>
        <AlertTriangle size={16} className="text-[var(--warning)]" />
      </div>

      {ranked.length === 0 ? (
        <div className="py-8 text-center text-sm text-[var(--text-muted)]">
          No decks yet — add cards to see your weakest areas
        </div>
      ) : (
        <div className="space-y-5">
          {ranked.map(({ deck, mastery }) => (
            <div key={deck.id}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[15px] font-medium text-[var(--text-primary)] truncate">{deck.name}</p>
                <span className={`font-mono text-[11px] ml-2 shrink-0 ${mastery < 40 ? 'text-[var(--danger)]' : mastery < 70 ? 'text-[var(--warning)]' : 'text-[var(--success)]'}`}>
                  {mastery < 40 ? 'Low Mastery' : mastery < 70 ? 'Needs Review' : 'Stable'}
                </span>
              </div>
              <Progress value={mastery} color={mastery < 40 ? 'danger' : mastery < 70 ? 'warning' : 'success'} size="sm" />
              <p className="font-mono text-[11px] text-[var(--text-muted)] mt-1.5">M: {mastery}%</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
