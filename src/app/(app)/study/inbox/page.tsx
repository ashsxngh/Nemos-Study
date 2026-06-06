'use client'

import Link from 'next/link'
import { ArrowLeft, Inbox, Play, CheckCircle2, Sparkles, RotateCcw } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/Button'
import { Progress } from '@/components/ui/Progress'
import { useLibraryStore } from '@/store/useLibraryStore'

export default function InboxPage() {
  const { getDueCards, getNewCards, getReviewsDue, decks } = useLibraryStore()
  const dueCards = getDueCards()
  const newCards = getNewCards()
  const reviews = getReviewsDue()

  const isEmpty = dueCards.length === 0

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title="Inbox"
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
            <span className="text-sm font-semibold text-[var(--text-primary)]">Inbox</span>
          </div>
        }
      />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-lg mx-auto">
          {isEmpty ? (
            <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
              <div className="w-16 h-16 rounded-full bg-[var(--success-subtle)] flex items-center justify-center">
                <CheckCircle2 size={32} className="text-[var(--success)]" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-1">All caught up!</h2>
                <p className="text-sm text-[var(--text-muted)]">No cards due today. Come back tomorrow or try a different mode.</p>
              </div>
              <div className="flex gap-2 mt-2">
                <Link href="/study/session?mode=cram">
                  <Button variant="ghost" size="sm">Exam Cram</Button>
                </Link>
                <Link href="/study/session?mode=random">
                  <Button variant="ghost" size="sm">Random Mix</Button>
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius-lg)] p-6">
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-10 h-10 bg-[var(--accent-subtle)] rounded-[var(--radius)] flex items-center justify-center">
                    <Inbox size={20} className="text-[var(--accent)]" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-[var(--text-primary)]">Today&apos;s Inbox</h2>
                    <p className="text-xs text-[var(--text-muted)]">Your blend of new cards and due reviews</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-5">
                  <div className="bg-[var(--bg-hover)] rounded-[var(--radius)] p-3 flex items-center gap-2.5">
                    <Sparkles size={14} className="text-[var(--accent)] shrink-0" />
                    <div>
                      <p className="text-sm font-bold text-[var(--text-primary)]">{newCards.length}</p>
                      <p className="text-[10px] text-[var(--text-muted)]">New cards</p>
                    </div>
                  </div>
                  <div className="bg-[var(--bg-hover)] rounded-[var(--radius)] p-3 flex items-center gap-2.5">
                    <RotateCcw size={14} className="text-[var(--success)] shrink-0" />
                    <div>
                      <p className="text-sm font-bold text-[var(--text-primary)]">{reviews.length}</p>
                      <p className="text-[10px] text-[var(--text-muted)]">Reviews due</p>
                    </div>
                  </div>
                </div>

                <Link href="/study/session" className="block">
                  <Button variant="primary" size="lg" icon={<Play size={14} />} className="w-full justify-center">
                    Start Session ({dueCards.length} cards)
                  </Button>
                </Link>
              </div>

              <p className="text-xs text-center text-[var(--text-muted)]">
                Reviews are unlimited · New cards limited by your daily cap
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
