'use client'

import { useHistoryStore } from '@/store/useHistoryStore'
import { getPeriodRange, logsInRange, type Period } from '@/lib/periods'

interface PeriodStatsProps { period: Period }

export function PeriodStats({ period }: PeriodStatsProps) {
  const reviewLogs = useHistoryStore((s) => s.reviewLogs)
  const { start, end, prevStart, prevEnd } = getPeriodRange(period)

  const curLogs  = logsInRange(reviewLogs, start, end)
  const prevLogs = logsInRange(reviewLogs, prevStart, prevEnd)

  // Cumulative total as of end of each period
  const cumCur  = reviewLogs.filter((l) => new Date(l.reviewedAt) <= end).length
  const cumPrev = period === 'all'
    ? 0
    : reviewLogs.filter((l) => new Date(l.reviewedAt) <= prevEnd).length

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
      value: uniqueCardCount(curLogs),
      prev: uniqueCardCount(prevLogs),
    },
    {
      label: 'Cumulative reviews',
      value: cumCur,
      prev: period === 'all' ? null : cumPrev,
    },
    {
      label: 'Total reviews',
      value: curLogs.length,
      prev: prevLogs.length,
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
          <p className="text-xs text-[var(--text-muted)] mb-1.5">{statLabel}</p>
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
