'use client'

import Link from 'next/link'
import { ArrowLeft, RotateCcw, Play, CheckCircle2 } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/Button'
import { useLibraryStore } from '@/store/useLibraryStore'

export default function ReviewsPage() {
  const { getReviewsDue } = useLibraryStore()
  const reviews = getReviewsDue()

  const isEmpty = reviews.length === 0

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title="Reviews"
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
            <span className="text-sm font-semibold text-[var(--text-primary)]">Reviews</span>
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
                <p className="text-sm text-[var(--text-muted)]">
                  No reviews due today. Your cards are scheduled — check back tomorrow.
                </p>
              </div>
              <div className="flex gap-2 mt-2">
                <Link href="/study/new">
                  <Button variant="ghost" size="sm">Study New Cards</Button>
                </Link>
                <Link href="/study/session?mode=cram">
                  <Button variant="ghost" size="sm">Exam Cram</Button>
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius-lg)] p-6">
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-10 h-10 bg-[var(--success-subtle)] rounded-[var(--radius)] flex items-center justify-center">
                    <RotateCcw size={20} className="text-[var(--success)]" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-[var(--text-primary)]">Reviews Due</h2>
                    <p className="text-xs text-[var(--text-muted)]">Previously learned cards scheduled for today</p>
                  </div>
                </div>

                <div className="bg-[var(--bg-hover)] rounded-[var(--radius)] p-4 mb-5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[var(--text-secondary)]">Cards due today</span>
                    <span className="text-sm font-bold text-[var(--text-primary)]">{reviews.length}</span>
                  </div>
                </div>

                <Link href="/study/session?mode=reviews" className="block">
                  <Button variant="primary" size="lg" icon={<Play size={14} />} className="w-full justify-center">
                    Review {reviews.length} Card{reviews.length !== 1 ? 's' : ''}
                  </Button>
                </Link>
              </div>

              <p className="text-xs text-center text-[var(--text-muted)]">
                Reviews are unlimited — these are already learned cards
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
