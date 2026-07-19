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
  const { decks, cards, fsrsData, getNewCards, getReviewsDue, getDeckNewCount, getDeckDueCount } = useLibraryStore(
    useShallow((s) => ({
      decks: s.decks,
      cards: s.cards,
      fsrsData: s.fsrsData,
      getNewCards: s.getNewCards,
      getReviewsDue: s.getReviewsDue,
      getDeckNewCount: s.getDeckNewCount,
      getDeckDueCount: s.getDeckDueCount,
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

  // Per-deck badges show true, uncapped per-deck counts (getDeckNewCount /
  // getDeckDueCount) — NOT getNewCards/getReviewsDue, which apply the global
  // newCardsPerDay cap (slice to newCardsPerDay − studiedNewToday) and so
  // collapse every deck's new count to ~20. The header totals above stay on
  // the capped queries because they represent the real inbox queue.
  const decksWithDue = useMemo(
    () =>
      decks
        .filter((d) => !d.isArchived)
        .map((deck) => ({
          deck,
          newCount: getDeckNewCount(deck.id),
          reviewCount: getDeckDueCount(deck.id),
        }))
        .filter((d) => d.newCount + d.reviewCount > 0),
    [decks, cards, fsrsData, getDeckNewCount, getDeckDueCount]
  )

  if (total === 0) return null

  return (
    <div className="card-surface p-8 mb-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <h3 className="meta-label text-[var(--text-secondary)]">Due now</h3>
          <div className="flex items-center gap-2.5 font-mono text-[11px] text-[var(--text-muted)]">
            {totalNew > 0 && (
              <span className="flex items-center gap-1.5 text-[var(--accent)]">
                <Sparkles size={12} />
                {totalNew} new
              </span>
            )}
            {totalNew > 0 && totalReviews > 0 && <span>·</span>}
            {totalReviews > 0 && (
              <span className="flex items-center gap-1.5 text-[var(--success)]">
                <RefreshCw size={12} />
                {totalReviews} reviews
              </span>
            )}
          </div>
        </div>
        <Link href="/study/session">
          <Button variant="primary" size="md" icon={<Play size={14} />}>
            Start Inbox
          </Button>
        </Link>
      </div>
      <div className="space-y-3">
        {decksWithDue.slice(0, 5).map(({ deck, newCount, reviewCount }) => (
          <div
            key={deck.id}
            className="flex items-center gap-3 p-3 rounded-lg bg-[var(--bg-raised)] hover:bg-[var(--bg-active)] transition-colors group"
          >
            <div className={`w-2 h-2 rounded-full shrink-0 ${newCount > 0 ? 'bg-[var(--accent)]' : 'bg-[var(--success)]'}`} />
            <span className="flex-1 text-[15px] text-[var(--text-primary)] truncate group-hover:text-[var(--accent)] transition-colors">{deck.name}</span>
            <div className="flex items-center gap-3 shrink-0 ml-4">
              <div className="flex items-center gap-1.5 font-mono text-[11px] text-[var(--text-muted)]">
                {newCount > 0 && (
                  <span className="text-[var(--accent)]">{newCount} new</span>
                )}
                {newCount > 0 && reviewCount > 0 && <span>·</span>}
                {reviewCount > 0 && (
                  <span>{reviewCount} due</span>
                )}
              </div>
              <Link href={`/study/session?deck=${deck.id}`}>
                <Button variant="ghost" size="sm" icon={<Play size={12} />}>
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
