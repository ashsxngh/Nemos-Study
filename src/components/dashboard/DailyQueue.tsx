'use client'

import Link from 'next/link'
import { Play } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useLibraryStore } from '@/store/useLibraryStore'

export function DailyQueue() {
  const { decks, getDueCards } = useLibraryStore()

  const decksWithDue = decks
    .filter((d) => !d.isArchived)
    .map((deck) => ({ deck, dueCount: getDueCards(deck.id).length }))
    .filter((d) => d.dueCount > 0)

  if (decksWithDue.length === 0) return null

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Due now</h3>
        <Link href="/study/session">
          <Button variant="primary" size="sm" icon={<Play size={11} />}>
            Start All
          </Button>
        </Link>
      </div>
      <div className="space-y-1">
        {decksWithDue.slice(0, 5).map(({ deck, dueCount }) => (
          <div
            key={deck.id}
            className="flex items-center justify-between py-1.5 text-sm"
          >
            <span className="text-[var(--text-secondary)] truncate">{deck.name}</span>
            <div className="flex items-center gap-3 shrink-0 ml-4">
              <span className="text-xs text-[var(--text-muted)]">{dueCount} cards</span>
              <Link href={`/study/session?deck=${deck.id}`}>
                <Button variant="ghost" size="xs" icon={<Play size={10} />}>
                  Review
                </Button>
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
