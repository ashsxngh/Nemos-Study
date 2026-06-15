'use client'

import Link from 'next/link'
import { Calendar, AlertTriangle, ArrowRight } from 'lucide-react'
import { Progress } from '@/components/ui/Progress'
import { cn } from '@/lib/utils'
import { useExamStore } from '@/store/useExamStore'
import { useLibraryStore } from '@/store/useLibraryStore'
import { computeExamRetentionStats, getExamCards } from '@/lib/examScheduler'
import type { Exam } from '@/lib/types'

function daysUntil(dateStr: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.ceil((new Date(dateStr + 'T00:00').getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

const urgencyColor = (days: number) =>
  days <= 7 ? 'text-[var(--danger)]' : days <= 14 ? 'text-[var(--warning)]' : 'text-[var(--text-secondary)]'
const urgencyBg = (days: number) =>
  days <= 7 ? 'bg-[var(--danger-subtle)]' : days <= 14 ? 'bg-[var(--warning-subtle)]' : 'bg-[var(--bg-active)]'

function retentionColor(r: number) {
  if (r >= 0.85) return 'success' as const
  if (r >= 0.65) return 'accent' as const
  return 'danger' as const
}

function ExamRow({ exam }: { exam: Exam }) {
  const { decks, folders, cards, fsrsData } = useLibraryStore()

  const days = daysUntil(exam.date)
  const examCards = getExamCards(exam, decks, cards, folders)
  const stats = computeExamRetentionStats(exam, examCards, fsrsData)
  const retPct = Math.round(stats.avgRetention * 100)

  return (
    <Link
      href="/planner"
      className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--bg-hover)] transition-colors border-b border-[var(--border)] last:border-0"
    >
      <div className={cn('w-9 h-9 rounded-[var(--radius-sm)] flex flex-col items-center justify-center shrink-0', urgencyBg(days))}>
        <span className={cn('text-sm font-bold leading-none', urgencyColor(days))}>{days}</span>
        <span className="text-[9px] text-[var(--text-muted)] mt-0.5">days</span>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="text-xs font-medium text-[var(--text-primary)] truncate">{exam.name}</p>
          {stats.pulledForwardCount > 0 && (
            <span className="flex items-center gap-0.5 text-[9px] text-[var(--warning)] shrink-0">
              <AlertTriangle size={9} />
              {stats.pulledForwardCount} early
            </span>
          )}
        </div>
        <p className="text-[10px] text-[var(--text-muted)]">
          {exam.subject} · {new Date(exam.date + 'T00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </p>

        {stats.reviewedCards > 0 && (
          <div className="flex items-center gap-2 mt-1">
            <Progress value={retPct} max={100} size="sm" className="w-20" color={retentionColor(stats.avgRetention)} />
            <span className="text-[9px] text-[var(--text-muted)]">{retPct}% retention</span>
          </div>
        )}
        {/* Status message */}
        {stats.totalCards > 0 && stats.reviewedCards > 0 && (() => {
          const behind = stats.avgRetention < (exam.targetRetention ?? 0.90)
          if (behind) {
            const load = stats.dailyLoadNeeded > 0 ? stats.dailyLoadNeeded : stats.atRisk
            return (
              <p className="text-[9px] text-[var(--danger)] mt-0.5 flex items-center gap-0.5">
                <AlertTriangle size={8} />
                {load > 0 ? `~${load} reviews/day to catch up` : `${stats.atRisk} cards at risk`}
              </p>
            )
          }
          return (
            <p className="text-[9px] text-[var(--success)] mt-0.5">On track ✓</p>
          )
        })()}
        {stats.totalCards === 0 && (
          <p className="text-[10px] text-[var(--text-muted)] mt-0.5">No decks linked</p>
        )}
      </div>
    </Link>
  )
}

export function ExamCountdowns() {
  const { exams } = useExamStore()

  const sorted = [...exams]
    .filter((e) => daysUntil(e.date) >= 0)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)]">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <Calendar size={13} className="text-[var(--text-muted)]" />
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Upcoming Exams</h2>
        </div>
        <Link
          href="/planner"
          className="flex items-center gap-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
        >
          Planner
          <ArrowRight size={11} />
        </Link>
      </div>

      {sorted.length === 0 ? (
        <div className="px-4 py-6 text-center space-y-2">
          <p className="text-xs text-[var(--text-muted)]">No upcoming exams</p>
          <Link
            href="/planner"
            className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
          >
            Add one in Planner
            <ArrowRight size={11} />
          </Link>
        </div>
      ) : (
        <div>
          {sorted.map((exam) => (
            <ExamRow key={exam.id} exam={exam} />
          ))}
        </div>
      )}
    </div>
  )
}
