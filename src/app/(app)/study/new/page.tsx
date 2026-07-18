'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { ArrowLeft, Sparkles, Play, CheckCircle2 } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/Button'
import { useLibraryStore } from '@/store/useLibraryStore'
import { useHistoryStore } from '@/store/useHistoryStore'
import { useSettingsStore } from '@/store/useSettingsStore'

export default function NewCardsPage() {
  const { cards, decks, fsrsData, getNewCards } = useLibraryStore(
    useShallow((s) => ({
      cards: s.cards,
      decks: s.decks,
      fsrsData: s.fsrsData,
      getNewCards: s.getNewCards,
    }))
  )
  const reviewLogs = useHistoryStore((s) => s.reviewLogs)
  const newCardsPerDay = useSettingsStore((s) => s.newCardsPerDay)
  const newCards = useMemo(
    () => getNewCards(),
    [cards, decks, fsrsData, reviewLogs, newCardsPerDay, getNewCards]
  )

  const isEmpty = newCards.length === 0

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title="New Cards"
        breadcrumbs={
          <div className="flex items-center gap-2 min-w-0">
            <Link
              href="/study"
              className="flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              <ArrowLeft size={13} />
              Study
            </Link>
            <span className="text-[var(--text-muted)]">/</span>
            <span className="text-sm font-semibold text-[var(--text-primary)]">New Cards</span>
          </div>
        }
      />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-lg mx-auto">
          {isEmpty ? (
            <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
              <div className="w-16 h-16 rounded-full bg-[var(--accent-subtle)] flex items-center justify-center">
                <CheckCircle2 size={32} className="text-[var(--accent)]" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-1">All caught up!</h2>
                <p className="text-sm text-[var(--text-muted)]">
                  You&apos;ve reached your daily limit of {newCardsPerDay} new cards, or there are no new cards left to learn.
                </p>
              </div>
              <Link href="/study">
                <Button variant="ghost" size="sm" icon={<ArrowLeft size={13} />}>Back to Study</Button>
              </Link>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius-lg)] p-6">
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-10 h-10 bg-[var(--accent-subtle)] rounded-[var(--radius)] flex items-center justify-center">
                    <Sparkles size={20} className="text-[var(--accent)]" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-[var(--text-primary)]">New Cards</h2>
                    <p className="text-xs text-[var(--text-muted)]">Cards you haven&apos;t studied yet</p>
                  </div>
                </div>

                <div className="bg-[var(--bg-hover)] rounded-[var(--radius)] p-4 mb-5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[var(--text-secondary)]">Ready to learn</span>
                    <span className="text-sm font-bold text-[var(--text-primary)]">
                      {newCards.length} / {newCardsPerDay} today
                    </span>
                  </div>
                </div>

                <Link href="/study/session?mode=new" className="block">
                  <Button variant="primary" size="lg" icon={<Play size={14} />} className="w-full justify-center">
                    Learn {newCards.length} New Card{newCards.length !== 1 ? 's' : ''}
                  </Button>
                </Link>
              </div>

              <p className="text-xs text-center text-[var(--text-muted)]">
                Learned cards join your Reviews queue the same day
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
