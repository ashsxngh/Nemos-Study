'use client'

import { AlertTriangle } from 'lucide-react'
import { Progress } from '@/components/ui/Progress'
import { useLibraryStore } from '@/store/useLibraryStore'

export function HardestTopics() {
  const { decks, getDeckMastery } = useLibraryStore()

  const ranked = decks
    .filter((d) => !d.isArchived)
    .map((deck) => ({ deck, mastery: getDeckMastery(deck.id) }))
    .sort((a, b) => a.mastery - b.mastery)
    .slice(0, 5)

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)]">
        <AlertTriangle size={13} className="text-[var(--warning)]" />
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Hardest Topics</h2>
      </div>

      {ranked.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-[var(--text-muted)]">
          No decks yet — add cards to see your weakest areas
        </div>
      ) : (
        <div className="divide-y divide-[var(--border)]">
          {ranked.map(({ deck, mastery }) => (
            <div key={deck.id} className="px-4 py-2.5 hover:bg-[var(--bg-hover)] transition-colors">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs font-medium text-[var(--text-primary)] truncate">{deck.name}</p>
                <span className="text-xs font-semibold text-[var(--danger)] ml-2 shrink-0">{mastery}%</span>
              </div>
              <Progress value={mastery} color={mastery < 40 ? 'danger' : mastery < 70 ? 'warning' : 'success'} size="sm" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
