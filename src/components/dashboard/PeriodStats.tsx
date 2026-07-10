'use client'

import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useHistoryStore } from '@/store/useHistoryStore'
import { useLibraryStore } from '@/store/useLibraryStore'
import { getPeriodRange, logsInRange, type Period } from '@/lib/periods'

interface PeriodStatsProps { period: Period }

export function PeriodStats({ period }: PeriodStatsProps) {
  const reviewLogs = useHistoryStore((s) => s.reviewLogs)
  const { cards, fsrsData } = useLibraryStore(
    useShallow((s) => ({ cards: s.cards, fsrsData: s.fsrsData }))
  )
  const { start, end, prevStart, prevEnd } = getPeriodRange(period)

  const curLogs  = logsInRange(reviewLogs, start, end)
  const prevLogs = logsInRange(reviewLogs, prevStart, prevEnd)

  // "Reviews" exclude wasNew logs — a first exposure (graduation) is a new
  // card being learned, not a repeat review.
  const curReviews  = curLogs.filter((l) => !l.wasNew)
  const prevReviews = prevLogs.filter((l) => !l.wasNew)

  // Total cards learned — cards that have graduated out of 'new' into the
  // FSRS schedule. Every card gets an fsrsData row at creation (state 'new'),
  // so counting all rows would just duplicate "Total cards".
  const totalLearned = useMemo(
    () => cards.filter((c) => {
      const fs = fsrsData[c.id]
      return !!fs && fs.state !== 'new'
    }).length,
    [cards, fsrsData]
  )

  const retentionOf = (logs: typeof reviewLogs) => {
    const reviewed = logs.filter((l) => !l.wasNew)
    return reviewed.length > 0
      ? Math.round((reviewed.filter((l) => l.rating >= 2).length / reviewed.length) * 100)
      : null
  }

  const curRet  = retentionOf(curLogs)
  const prevRet = retentionOf(prevLogs)

  const uniqueCardCount = (logs: typeof reviewLogs) => new Set(logs.map((l) => l.cardId)).size

  // Names the actual prior window being compared against, rather than
  // reusing the current period's own label (which used to render nonsense
  // like "prev. today" / "prev. yesterday").
  const PREV_WINDOW_LABELS: Record<Period, string> = {
    today: 'yesterday',
    yesterday: 'day before',
    '7d': 'prev. 7 days',
    '30d': 'prev. 30 days',
    '6m': 'prev. 6 months',
    '1y': 'prev. year',
    all: '',
  }
  const prevLabel = PREV_WINDOW_LABELS[period]

  const stats = [
    {
      label: 'Cards reviewed',
      value: uniqueCardCount(curReviews),
      prev: uniqueCardCount(prevReviews),
    },
    {
      label: 'Total cards learned',
      value: totalLearned,
      prev: null,
    },
    {
      label: 'Total reviews',
      value: curReviews.length,
      prev: prevReviews.length,
    },
    {
      label: 'Retention rate',
      value: curRet !== null ? `${curRet}%` : '—',
      prev: prevRet !== null ? `${prevRet}%` : '—',
    },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-0 mt-6 divide-x divide-[var(--border)]">
      {stats.map(({ label: statLabel, value, prev }, i) => (
        <div key={statLabel} className={i === 0 ? 'pr-6' : 'px-6'}>
          <p className="meta-label text-[var(--text-muted)] mb-1.5">{statLabel}</p>
          <p className="text-2xl font-bold text-[var(--text-primary)] leading-none mb-1">{value}</p>
          {prev !== null && (
            <p className="text-xs text-[var(--text-muted)]">
              {prev} {prevLabel}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}
