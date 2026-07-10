'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { Play, Sparkles, RefreshCw } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { Button } from '@/components/ui/Button'
import { useLibraryStore } from '@/store/useLibraryStore'
import { useHistoryStore } from '@/store/useHistoryStore'
import { useSettingsStore } from '@/store/useSettingsStore'

export function DailyQueue() {
  const { decks, cards, fsrsData, getNewCards, getReviewsDue } = useLibraryStore(
    useShallow((s) => ({
      decks: s.decks,
      cards: s.cards,
      fsrsData: s.fsrsData,
      getNewCards: s.getNewCards,
      getReviewsDue: s.getReviewsDue,
    }))
  )
  const reviewLogs = useHistoryStore((s) => s.reviewLogs)
  const newCardsPerDay = useSettingsStore((s) => s.newCardsPerDay)

  const totalNew = useMemo(
    () => getNewCards().length,
    [cards, decks, fsrsData, reviewLogs, newCardsPerDay, getNewCards]
  )
  const totalReviews = useMemo(
    () => getReviewsDue().length,
    [cards, decks, fsrsData, getReviewsDue]
  )
  const total = totalNew + totalReviews

  const decksWithDue = useMemo(
    () =>
      decks
        .filter((d) => !d.isArchived)
        .map((deck) => ({
          deck,
          newCount: getNewCards(deck.id).length,
          reviewCount: getReviewsDue(deck.id).length,
        }))
        .filter((d) => d.newCount + d.reviewCount > 0),
    [decks, cards, fsrsData, reviewLogs, newCardsPerDay, getNewCards, getReviewsDue]
  )

  if (total === 0) return null

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <h3 className="meta-label text-[var(--text-secondary)]">Due now</h3>
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
