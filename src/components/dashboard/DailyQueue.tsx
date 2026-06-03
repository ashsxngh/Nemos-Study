'use client'

import Link from 'next/link'
import { Play, Sparkles, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useLibraryStore } from '@/store/useLibraryStore'

export function DailyQueue() {
  const { decks, getNewCards, getReviewsDue } = useLibraryStore()

  const totalNew = getNewCards().length
  const totalReviews = getReviewsDue().length
  const total = totalNew + totalReviews

  const decksWithDue = decks
    .filter((d) => !d.isArchived)
    .map((deck) => ({
      deck,
      newCount: getNewCards(deck.id).length,
      reviewCount: getReviewsDue(deck.id).length,
    }))
    .filter((d) => d.newCount + d.reviewCount > 0)

  if (total === 0) return null

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Due now</h3>
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            {totalNew > 0 && (
              <span className="flex items-center gap-1 text-[var(--accent)]">
                <Sparkles size={10} />
                {totalNew} new
              </span>
            )}
            {totalNew > 0 && totalReviews > 0 && <span>·</span>}
            {totalReviews > 0 && (
              <span className="flex items-center gap-1 text-[var(--success)]">
                <RefreshCw size={10} />
                {totalReviews} reviews
              </span>
            )}
          </div>
        </div>
        <Link href="/study/session">
          <Button variant="primary" size="sm" icon={<Play size={11} />}>
            Start Inbox
          </Button>
        </Link>
      </div>
      <div className="space-y-1">
        {decksWithDue.slice(0, 5).map(({ deck, newCount, reviewCount }) => (
          <div
            key={deck.id}
            className="flex items-center justify-between py-1.5 text-sm"
          >
            <span className="text-[var(--text-secondary)] truncate">{deck.name}</span>
            <div className="flex items-center gap-3 shrink-0 ml-4">
              <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                {newCount > 0 && (
                  <span className="text-[var(--accent)]">{newCount} new</span>
                )}
                {newCount > 0 && reviewCount > 0 && <span>·</span>}
                {reviewCount > 0 && (
                  <span>{reviewCount} due</span>
                )}
              </div>
              <Link href={`/study/session?deck=${deck.id}`}>
                <Button variant="ghost" size="xs" icon={<Play size={10} />}>
                  Study
                </Button>
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
