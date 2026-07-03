'use client'

import { useState, useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useHistoryStore } from '@/store/useHistoryStore'
import { getPeriodRange, logsInRange, type Period } from '@/lib/periods'

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
  const { reviewLogs, sessions } = useHistoryStore(
    useShallow((s) => ({ reviewLogs: s.reviewLogs, sessions: s.sessions }))
  )
  const { start, end } = getPeriodRange(period)

  const periodLogs = logsInRange(reviewLogs, start, end)
  const reviewOnlyLogs = periodLogs.filter((l) => !l.wasNew)

  // Cards reviewed in period
  const cardsReviewed = periodLogs.length

  // Retention rate — new card graduation events excluded (wasNew logs skew accuracy down)
  const retention = reviewOnlyLogs.length > 0
    ? Math.round((reviewOnlyLogs.filter((l) => l.rating >= 3).length / reviewOnlyLogs.length) * 100)
    : 0

  // Total reviews (cumulative if "all time", else period)
  const totalReviews = period === 'all' ? reviewLogs.length : periodLogs.length

  // Study time in period
  const periodSessions = sessions.filter((s) => {
    if (!s.endedAt) return false
    const t = new Date(s.startedAt)
    return t >= start && t <= end
  })
  const reviewTimeMin = Math.round(
    periodSessions.reduce((sum, s) => {
      if (!s.endedAt) return sum
      return sum + (new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 60000
    }, 0)
  )

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
    <div className="flex items-stretch divide-x divide-[var(--border)] mb-8">
      {stats.map(({ label, value }, i) => (
        <div key={label} className={i === 0 ? 'pr-8' : 'px-8'}>
          <p className="text-xs text-[var(--text-muted)] mb-1">{label}</p>
          <p className="text-3xl font-bold text-[var(--text-primary)] leading-none">{value}</p>
        </div>
      ))}
    </div>
  )
}
