'use client'

import { useLibraryStore } from '@/store/useLibraryStore'
import { getPeriodRange, logsInRange, type Period } from '@/lib/periods'

interface PeriodStatsProps { period: Period }

export function PeriodStats({ period }: PeriodStatsProps) {
  const { reviewLogs } = useLibraryStore()
  const { start, end, prevStart, prevEnd, label } = getPeriodRange(period)

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
      ? Math.round((reviewed.filter((l) => l.rating >= 3).length / reviewed.length) * 100)
      : null
  }

  const curRet  = retentionOf(curLogs)
  const prevRet = retentionOf(prevLogs)

  const prevLabel = period === 'all' ? '' : `prev. ${label.toLowerCase()}`

  const stats = [
    {
      label: 'Cards reviewed',
      value: curLogs.length,
      prev: prevLogs.length,
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
