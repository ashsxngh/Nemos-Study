'use client'

import { useState, useEffect } from 'react'
import { useHistoryStore } from '@/store/useHistoryStore'
import { getPeriodRange, logsInRange, type Period } from '@/lib/periods'
import { activeStudyMs } from '@/lib/activeTime'

function useCountUp(target: number, duration = 800): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (target === 0) { setCount(0); return }
    const start = performance.now()
    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setCount(Math.round(eased * target))
      if (progress < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [target, duration])
  return count
}

interface StatsOverviewProps { period: Period }

export function StatsOverview({ period }: StatsOverviewProps) {
  const reviewLogs = useHistoryStore((s) => s.reviewLogs
  )
  const { start, end } = getPeriodRange(period)

  const periodLogs = logsInRange(reviewLogs, start, end)
  const reviewOnlyLogs = periodLogs.filter((l) => !l.wasNew)

  // Cards reviewed in period (unique cards, not total review events — see Total
  // Reviews below). wasNew logs excluded: a first exposure is a card being
  // learned, not a review.
  const cardsReviewed = new Set(reviewOnlyLogs.map((l) => l.cardId)).size

  // Retention rate — new card graduation events excluded (wasNew logs skew accuracy down)
  const retention = reviewOnlyLogs.length > 0
    ? Math.round((reviewOnlyLogs.filter((l) => l.rating >= 2).length / reviewOnlyLogs.length) * 100)
    : 0

  // Total reviews (cumulative if "all time", else period) — repeat reviews
  // only, new-card graduations excluded
  const totalReviews = period === 'all'
    ? reviewLogs.filter((l) => !l.wasNew).length
    : reviewOnlyLogs.length

  // Study time in period — active foreground time per card (each capped at
  // 60s), not session wall clock. The old `endedAt - startedAt` sum counted
  // backgrounded tabs, interruptions and time parked on the completion screen.
  const reviewTimeMin = Math.round(activeStudyMs(periodLogs) / 60000)

  const animatedCards     = useCountUp(cardsReviewed)
  const animatedRetention = useCountUp(retention)
  const animatedTotal     = useCountUp(totalReviews)
  const animatedTimeH     = useCountUp(Math.floor(reviewTimeMin / 60))
  const animatedTimeM     = useCountUp(reviewTimeMin % 60)
  const animatedTimeMin2  = useCountUp(reviewTimeMin)

  const reviewTimeStr = reviewTimeMin >= 60
    ? `${animatedTimeH}h ${animatedTimeM}m`
    : `${animatedTimeMin2}m`

  const stats = [
    { label: 'Cards Reviewed',  value: String(animatedCards) },
    { label: 'Retention Rate',  value: reviewOnlyLogs.length > 0 ? `${animatedRetention}%` : '—' },
    { label: 'Total Reviews',   value: String(animatedTotal) },
    { label: 'Study Time',      value: reviewTimeMin > 0 ? reviewTimeStr : '0m' },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      {stats.map(({ label, value }) => (
        <div key={label} className="card-surface card-hover p-7">
          <p className="meta-label text-[var(--text-secondary)] mb-5">{label}</p>
          <p className="text-[2.75rem] font-semibold tracking-tight text-[var(--text-primary)] leading-none">{value}</p>
        </div>
      ))}
    </div>
  )
}
