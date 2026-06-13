'use client'

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  BarChart3, TrendingUp, Brain, Clock, Flame, Target, AlertTriangle, Bug,
  Zap, Activity, ArrowUp, ArrowDown
} from 'lucide-react'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell
} from 'recharts'
import { Progress } from '@/components/ui/Progress'
import { Badge } from '@/components/ui/Badge'
import { useLibraryStore } from '@/store/useLibraryStore'
import { useSettingsStore } from '@/store/useSettingsStore'
import { cn } from '@/lib/utils'

// ── useCountUp hook ───────────────────────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeStreak(logs: { reviewedAt: string }[]): number {
  if (logs.length === 0) return 0
  const days = new Set(logs.map((l) => l.reviewedAt.slice(0, 10)))
  let streak = 0
  const today = new Date()
  for (let i = 0; i < 365; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    if (days.has(d.toISOString().slice(0, 10))) streak++
    else break
  }
  return streak
}

function dateStr(daysAgo: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString().slice(0, 10)
}

function shortDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function groupLogsByCard<T extends { cardId: string }>(logs: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const log of logs) {
    const list = map.get(log.cardId) ?? []
    list.push(log)
    map.set(log.cardId, list)
  }
  return map
}

function sortedCardLogs<T extends { cardId: string; reviewedAt: string }>(logs: T[]): Map<string, T[]> {
  const map = groupLogsByCard(logs)
  for (const [k, v] of map) {
    map.set(k, v.sort((a, b) => new Date(a.reviewedAt).getTime() - new Date(b.reviewedAt).getTime()))
  }
  return map
}

// ── Circular progress ring ─────────────────────────────────────────────────

interface RingProps { value: number; size?: number; stroke?: number }

function CircleRing({ value, size = 96, stroke = 8 }: RingProps) {
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const offset = circ - (value / 100) * circ
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', position: 'absolute' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-active)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--accent)" strokeWidth={stroke}
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.5s ease' }} />
      </svg>
      <span className="text-2xl font-bold text-[var(--text-primary)] relative z-10">{Math.round(value)}</span>
    </div>
  )
}

// ── Section divider ───────────────────────────────────────────────────────────

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 pt-3">
      <div className="flex-1 h-px bg-[var(--border)]" />
      <span className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-widest whitespace-nowrap">{label}</span>
      <div className="flex-1 h-px bg-[var(--border)]" />
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ message = 'Not enough data yet' }: { message?: string }) {
  return (
    <div className="flex items-center justify-center h-16 text-xs text-[var(--text-muted)]">{message}</div>
  )
}

// ── Tab bar ───────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'decks', label: 'Decks' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'habits', label: 'Habits' },
  { id: 'insights', label: 'Insights' },
]

// ── Main ──────────────────────────────────────────────────────────────────────

export function StatsPage() {
  const [activeTab, setActiveTab] = useState('overview')
  const router = useRouter()

  const { cards, decks, sessions, reviewLogs, getDeckMastery } = useLibraryStore()
  const srsData = useLibraryStore((s) => s.srsData)
  const fsrsData = useLibraryStore((s) => s.fsrsData)
  const { burnoutWarningEnabled, burnoutThresholdCards, leechThreshold, algorithm } = useSettingsStore()

  // ── Core aggregates ──────────────────────────────────────────────────────
  const totalCards = cards.length
  const masteredCards = useMemo(
    () => cards.filter((c) => srsData[c.id]?.masteryPercent >= 80).length,
    [cards, srsData]
  )

  const oneMonthAgo = useMemo(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1); return d
  }, [])

  const monthMinutes = useMemo(() => {
    const monthSessions = sessions.filter((s) => s.endedAt && new Date(s.startedAt) > oneMonthAgo)
    return Math.round(
      monthSessions.reduce((sum, s) => {
        if (!s.endedAt) return sum
        return sum + (new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 60000
      }, 0)
    )
  }, [sessions, oneMonthAgo])

  const streak = useMemo(() => computeStreak(reviewLogs), [reviewLogs])

  const todayStr = new Date().toISOString().slice(0, 10)
  const todayDueCount = useMemo(
    () => Object.values(srsData).filter((s) => s.dueDate.slice(0, 10) <= todayStr).length,
    [srsData, todayStr]
  )

  const retentionData = useMemo(() => {
    return Array.from({ length: 30 }, (_, i) => {
      const ds = dateStr(29 - i)
      const dayLogs = reviewLogs.filter((l) => l.reviewedAt.slice(0, 10) === ds)
      if (dayLogs.length === 0) return { date: shortDate(ds), retention: null }
      const correct = dayLogs.filter((l) => l.rating >= 3).length
      return { date: shortDate(ds), retention: Math.round((correct / dayLogs.length) * 100) }
    })
  }, [reviewLogs])

  const ratingCounts = useMemo(() => {
    const counts = [0, 0, 0, 0]
    reviewLogs.forEach((l) => { counts[l.rating - 1]++ })
    return counts
  }, [reviewLogs])
  const totalRatings = ratingCounts.reduce((a, b) => a + b, 0)

  const avgResponseByRating = useMemo(() => {
    const byRating: Record<number, number[]> = { 1: [], 2: [], 3: [], 4: [] }
    reviewLogs.forEach((l) => { if (l.responseMs > 0) byRating[l.rating].push(l.responseMs) })
    return Object.fromEntries(
      Object.entries(byRating).map(([r, ms]) => [
        r,
        ms.length > 0 ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length / 1000) : null,
      ])
    ) as Record<number, number | null>
  }, [reviewLogs])

  const deckStats = useMemo(() => {
    return decks
      .filter((d) => !d.isArchived)
      .map((deck) => ({
        id: deck.id,
        name: deck.name,
        total: cards.filter((c) => c.deckId === deck.id).length,
        mastery: getDeckMastery(deck.id),
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8)
  }, [decks, cards, getDeckMastery])
  const maxDeckCards = Math.max(...deckStats.map((d) => d.total), 1)

  const consistencyScore = useMemo(() => {
    const studiedDays = new Set(
      reviewLogs
        .filter((l) => (Date.now() - new Date(l.reviewedAt).getTime()) / 86400000 <= 30)
        .map((l) => l.reviewedAt.slice(0, 10))
    ).size
    return Math.round((studiedDays / 30) * 100)
  }, [reviewLogs])

  const leechCards = useMemo(() => {
    return cards
      .filter((c) => (srsData[c.id]?.lapses ?? 0) >= leechThreshold)
      .map((c) => ({ id: c.id, front: c.front, lapses: srsData[c.id]?.lapses ?? 0 }))
      .sort((a, b) => b.lapses - a.lapses)
  }, [cards, srsData, leechThreshold])

  const weeklyData = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const ds = dateStr(6 - i)
      const d = new Date(ds)
      const count = reviewLogs.filter((l) => l.reviewedAt.slice(0, 10) === ds).length
      return { day: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()], cards: count }
    })
  }, [reviewLogs])
  const maxCards = Math.max(...weeklyData.map((d) => d.cards), 1)

  const subjectMastery = useMemo(() => {
    return decks
      .filter((d) => !d.isArchived)
      .map((deck) => ({
        subject: deck.name,
        mastery: getDeckMastery(deck.id),
        cards: cards.filter((c) => c.deckId === deck.id).length,
      }))
      .sort((a, b) => b.mastery - a.mastery)
  }, [decks, cards, getDeckMastery])

  const animatedTotalCards = useCountUp(totalCards)
  const animatedMastered = useCountUp(masteredCards)
  const animatedMonthMinutes = useCountUp(monthMinutes)
  const animatedStreak = useCountUp(streak)
  const animatedMonthHours = useCountUp(Math.floor(monthMinutes / 60))
  const animatedMonthRem = useCountUp(monthMinutes % 60)

  const studyTimeStr = monthMinutes >= 60
    ? `${animatedMonthHours}h ${animatedMonthRem}m`
    : `${animatedMonthMinutes}m`

  const overallStats = [
    { label: 'Total cards', value: String(animatedTotalCards), icon: Brain, color: 'text-[var(--accent)]' },
    { label: 'Cards mastered', value: String(animatedMastered), sub: totalCards > 0 ? `${Math.round((masteredCards / totalCards) * 100)}%` : '0%', icon: Target, color: 'text-[var(--success)]' },
    { label: 'Study time', value: studyTimeStr, sub: 'this month', icon: Clock, color: 'text-sky-400' },
    { label: 'Current streak', value: String(animatedStreak), sub: 'days', icon: Flame, color: 'text-orange-400' },
  ]

  const ratingLabels = ['Again', 'Hard', 'Good', 'Easy']
  const ratingColors = ['bg-red-500', 'bg-orange-500', 'bg-[var(--accent)]', 'bg-[var(--success)]']
  const ratingTextColors = ['text-red-400', 'text-orange-400', 'text-[var(--accent)]', 'text-[var(--success)]']

  // ════════════════════════════════════════════════════════════════════════════
  // INSIGHTS — Model & Calibration
  // ════════════════════════════════════════════════════════════════════════════

  // #1 — Predicted R vs actual recall rate
  const modelCalibration = useMemo(() => {
    const byCard = sortedCardLogs(reviewLogs)
    const buckets = [
      { label: '<50%', min: 0, max: 0.5, remembered: 0, total: 0 },
      { label: '50–70%', min: 0.5, max: 0.7, remembered: 0, total: 0 },
      { label: '70–85%', min: 0.7, max: 0.85, remembered: 0, total: 0 },
      { label: '85–95%', min: 0.85, max: 0.95, remembered: 0, total: 0 },
      { label: '>95%', min: 0.95, max: 1.01, remembered: 0, total: 0 },
    ]
    for (const [, logs] of byCard) {
      for (let i = 1; i < logs.length; i++) {
        const prev = logs[i - 1], curr = logs[i]
        const t = (new Date(curr.reviewedAt).getTime() - new Date(prev.reviewedAt).getTime()) / 86400000
        const S = Math.max(0.1, prev.scheduledInterval)
        const predictedR = Math.pow(1 + t / (9 * S), -1)
        const b = buckets.find((b) => predictedR >= b.min && predictedR < b.max) ?? buckets[buckets.length - 1]
        b.total++
        if (curr.rating >= 2) b.remembered++
      }
    }
    return buckets
      .filter((b) => b.total >= 3)
      .map((b) => ({
        label: b.label,
        predicted: Math.round(((b.min + Math.min(b.max, 1)) / 2) * 100),
        actual: Math.round((b.remembered / b.total) * 100),
        total: b.total,
      }))
  }, [reviewLogs])

  // R at lapse: what retrievability were cards at when they actually failed?
  const rAtLapse = useMemo(() => {
    const byCard = sortedCardLogs(reviewLogs)
    const buckets = [
      { label: '<60%', min: 0, max: 0.6, count: 0 },
      { label: '60–70%', min: 0.6, max: 0.7, count: 0 },
      { label: '70–80%', min: 0.7, max: 0.8, count: 0 },
      { label: '80–90%', min: 0.8, max: 0.9, count: 0 },
      { label: '>90%', min: 0.9, max: 1.01, count: 0 },
    ]
    let totalLapses = 0
    for (const [, logs] of byCard) {
      for (let i = 1; i < logs.length; i++) {
        if (logs[i].rating !== 1) continue
        const t = (new Date(logs[i].reviewedAt).getTime() - new Date(logs[i - 1].reviewedAt).getTime()) / 86400000
        const S = Math.max(0.1, logs[i - 1].scheduledInterval)
        const R = Math.pow(1 + t / (9 * S), -1)
        const b = buckets.find((b) => R >= b.min && R < b.max) ?? buckets[buckets.length - 1]
        b.count++
        totalLapses++
      }
    }
    if (totalLapses < 5) return null
    // Find the median bucket (which R is most lapses happening at)
    const maxBucket = [...buckets].sort((a, b) => b.count - a.count)[0]
    // Retention target recommendation
    const highRLapses = buckets.filter(b => b.min >= 0.85).reduce((s, b) => s + b.count, 0)
    const highRPct = Math.round((highRLapses / totalLapses) * 100)
    let recommendation: string
    if (highRPct >= 40) recommendation = 'Most lapses happen above 85% R — you\'re being reviewed too early. Consider pushing target retention to 0.95.'
    else if (highRPct <= 15) recommendation = 'Most lapses happen below 80% R — your target retention is well-matched to your actual forgetting curve.'
    else recommendation = 'Lapses spread evenly across R levels — your 0.9 target is a reasonable fit.'

    return {
      buckets: buckets.map(b => ({ label: b.label, count: b.count, pct: totalLapses > 0 ? Math.round((b.count / totalLapses) * 100) : 0 })),
      totalLapses,
      peakBucket: maxBucket.label,
      recommendation,
      highRPct,
    }
  }, [reviewLogs])

  // ════════════════════════════════════════════════════════════════════════════
  // INSIGHTS — Review Timing Behavior
  // ════════════════════════════════════════════════════════════════════════════

  const reviewTiming = useMemo(() => {
    const byCard = sortedCardLogs(reviewLogs)
    let earlyCount = 0, lateCount = 0, onTimeCount = 0
    let totalEarlyDays = 0, totalLateDays = 0
    let earlyPass = 0, latePass = 0, onTimePass = 0

    const windowBuckets = [
      { label: '3d+ early', min: -Infinity, max: -3, pass: 0, total: 0 },
      { label: '1–3d early', min: -3, max: -1, pass: 0, total: 0 },
      { label: '±1d (on time)', min: -1, max: 1.5, pass: 0, total: 0 },
      { label: '1–3d late', min: 1.5, max: 3, pass: 0, total: 0 },
      { label: '3–7d late', min: 3, max: 7, pass: 0, total: 0 },
      { label: '7d+ late', min: 7, max: Infinity, pass: 0, total: 0 },
    ]

    for (const [, logs] of byCard) {
      for (let i = 1; i < logs.length; i++) {
        const prev = logs[i - 1], curr = logs[i]
        if (prev.scheduledInterval <= 0) continue
        const dueMs = new Date(prev.reviewedAt).getTime() + prev.scheduledInterval * 86400000
        const offsetDays = (new Date(curr.reviewedAt).getTime() - dueMs) / 86400000
        const passed = curr.rating >= 2

        if (offsetDays < -1) { earlyCount++; totalEarlyDays += -offsetDays; if (passed) earlyPass++ }
        else if (offsetDays > 1.5) { lateCount++; totalLateDays += offsetDays; if (passed) latePass++ }
        else { onTimeCount++; if (passed) onTimePass++ }

        const b = windowBuckets.find((b) => offsetDays >= b.min && offsetDays < b.max) ?? windowBuckets[windowBuckets.length - 1]
        b.total++
        if (passed) b.pass++
      }
    }

    const total = earlyCount + lateCount + onTimeCount
    if (total < 10) return null

    const filteredBuckets = windowBuckets
      .filter((b) => b.total >= 3)
      .map((b) => ({ label: b.label, rate: Math.round((b.pass / b.total) * 100), total: b.total }))

    const optimal = filteredBuckets.length > 0
      ? filteredBuckets.reduce((best, b) => b.rate > best.rate ? b : best, filteredBuckets[0])
      : null

    return {
      earlyRate: Math.round((earlyCount / total) * 100),
      lateRate: Math.round((lateCount / total) * 100),
      onTimeRate: Math.round((onTimeCount / total) * 100),
      avgDaysEarly: earlyCount > 0 ? Math.round((totalEarlyDays / earlyCount) * 10) / 10 : 0,
      avgDaysLate: lateCount > 0 ? Math.round((totalLateDays / lateCount) * 10) / 10 : 0,
      earlyPassRate: earlyCount > 0 ? Math.round((earlyPass / earlyCount) * 100) : null,
      onTimePassRate: onTimeCount > 0 ? Math.round((onTimePass / onTimeCount) * 100) : null,
      latePassRate: lateCount > 0 ? Math.round((latePass / lateCount) * 100) : null,
      windowBuckets: filteredBuckets,
      optimalWindow: optimal?.label ?? null,
      total,
    }
  }, [reviewLogs])

  // ════════════════════════════════════════════════════════════════════════════
  // INSIGHTS — Card Health
  // ════════════════════════════════════════════════════════════════════════════

  // #2 — Stability loss per lapse by card maturity
  const stabilityLossPerLapse = useMemo(() => {
    const byCard = sortedCardLogs(reviewLogs)
    const groups = [
      { label: 'Young (<7d)', max: 7, recoveries: [] as number[] },
      { label: 'Mature (7–30d)', max: 30, recoveries: [] as number[] },
      { label: 'Old (>30d)', max: Infinity, recoveries: [] as number[] },
    ]
    for (const [, logs] of byCard) {
      for (let i = 1; i < logs.length - 1; i++) {
        if (logs[i].rating !== 1) continue
        const preInterval = logs[i - 1].scheduledInterval
        const postInterval = logs[i + 1]?.scheduledInterval
        if (!postInterval || preInterval < 1) continue
        const ratio = Math.min(1, postInterval / preInterval)
        const g = groups.find((g) => preInterval < g.max) ?? groups[groups.length - 1]
        g.recoveries.push(ratio)
      }
    }
    return groups.map((g) => ({
      label: g.label,
      avgRecovery: g.recoveries.length > 0
        ? Math.round((g.recoveries.reduce((a, b) => a + b, 0) / g.recoveries.length) * 100)
        : null,
      count: g.recoveries.length,
    }))
  }, [reviewLogs])

  // #3 — Overdue but remembered
  const overdueStats = useMemo(() => {
    const byCard = sortedCardLogs(reviewLogs)
    let overdueTotal = 0, overdueRemembered = 0
    for (const [, logs] of byCard) {
      for (let i = 1; i < logs.length; i++) {
        const actualDays = (new Date(logs[i].reviewedAt).getTime() - new Date(logs[i - 1].reviewedAt).getTime()) / 86400000
        if (actualDays > logs[i - 1].scheduledInterval * 1.15) {
          overdueTotal++
          if (logs[i].rating >= 2) overdueRemembered++
        }
      }
    }
    return {
      rate: overdueTotal >= 5 ? Math.round((overdueRemembered / overdueTotal) * 100) : null,
      total: overdueTotal,
      remembered: overdueRemembered,
    }
  }, [reviewLogs])

  // #4 — Lapse clustering
  const lapseCluster = useMemo(() => {
    const lapseLogs = reviewLogs
      .filter((l) => l.rating === 1)
      .sort((a, b) => new Date(a.reviewedAt).getTime() - new Date(b.reviewedAt).getTime())
    if (lapseLogs.length < 4) return null
    const intervals: number[] = []
    for (let i = 1; i < lapseLogs.length; i++) {
      intervals.push((new Date(lapseLogs[i].reviewedAt).getTime() - new Date(lapseLogs[i - 1].reviewedAt).getTime()) / 86400000)
    }
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length
    const std = Math.sqrt(intervals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / intervals.length)
    const cv = mean > 0 ? std / mean : 0
    const monthData = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(); d.setMonth(d.getMonth() - (5 - i))
      const month = d.toISOString().slice(0, 7)
      return { month: month.slice(5), lapses: lapseLogs.filter((l) => l.reviewedAt.slice(0, 7) === month).length }
    })
    return { cv: Math.round(cv * 100) / 100, isBursty: cv > 1.2, monthData, totalLapses: lapseLogs.length }
  }, [reviewLogs])

  // #5 — Stability flatliners
  const stabilityFlatliners = useMemo(() => {
    if (algorithm !== 'fsrs') {
      return cards
        .filter((c) => { const s = srsData[c.id]; return s && s.repetitions >= 5 && s.easeFactor < 1.6 })
        .map((c) => ({ id: c.id, front: c.front, reps: srsData[c.id].repetitions, metric: Math.round(srsData[c.id].easeFactor * 100) / 100, metricLabel: 'ease' }))
        .sort((a, b) => a.metric - b.metric).slice(0, 6)
    }
    return cards
      .filter((c) => { const fs = fsrsData[c.id]; return fs && fs.repetitions >= 5 && fs.stability < 10 })
      .map((c) => ({ id: c.id, front: c.front, reps: fsrsData[c.id].repetitions, metric: Math.round(fsrsData[c.id].stability * 10) / 10, metricLabel: 'stability' }))
      .sort((a, b) => a.metric - b.metric).slice(0, 6)
  }, [cards, fsrsData, srsData, algorithm])

  // ════════════════════════════════════════════════════════════════════════════
  // INSIGHTS — Long-term Memory Architecture
  // ════════════════════════════════════════════════════════════════════════════

  // Mature card attrition: cards that hit S>21 — what % eventually lapse?
  const matureAttrition = useMemo(() => {
    const byCard = sortedCardLogs(reviewLogs)
    let matureCards = 0, attritionCards = 0
    const lapseStabilities: number[] = []

    for (const [, logs] of byCard) {
      let hitMature = false, lapseAfterMature = false
      for (let i = 1; i < logs.length; i++) {
        const preInterval = logs[i - 1].scheduledInterval
        if (preInterval >= 21) {
          hitMature = true
          if (logs[i].rating === 1) {
            lapseAfterMature = true
            lapseStabilities.push(preInterval)
          }
        }
      }
      if (hitMature) { matureCards++; if (lapseAfterMature) attritionCards++ }
    }

    if (matureCards < 3) return null
    const avgLapseS = lapseStabilities.length > 0
      ? Math.round(lapseStabilities.reduce((a, b) => a + b, 0) / lapseStabilities.length)
      : null

    // Bucket lapse stabilities to see where they cluster
    const sBuckets = [
      { label: '21–30d', min: 21, max: 30, count: 0 },
      { label: '30–60d', min: 30, max: 60, count: 0 },
      { label: '60–120d', min: 60, max: 120, count: 0 },
      { label: '120d+', min: 120, max: Infinity, count: 0 },
    ]
    lapseStabilities.forEach(s => {
      const b = sBuckets.find(b => s >= b.min && s < b.max)
      if (b) b.count++
    })

    return {
      matureCards,
      attritionRate: Math.round((attritionCards / matureCards) * 100),
      attritionCount: attritionCards,
      avgLapseS,
      sBuckets: sBuckets.filter(b => b.count > 0),
    }
  }, [reviewLogs])

  // Asymptotic learners: cards with 0 lapses and high current stability
  const asymptoticLearners = useMemo(() => {
    const byCard = groupLogsByCard(reviewLogs)
    const THRESHOLD = 30
    let reviewedCards = 0, asymptotic = 0

    for (const card of cards) {
      const logs = byCard.get(card.id) ?? []
      if (logs.length < 2) continue
      reviewedCards++
      if (logs.some(l => l.rating === 1)) continue

      if (algorithm === 'fsrs') {
        const fs = fsrsData[card.id]
        if (fs && fs.stability > THRESHOLD) asymptotic++
      } else {
        const srs = srsData[card.id]
        if (srs && srs.interval > THRESHOLD) asymptotic++
      }
    }

    return { count: asymptotic, total: reviewedCards, pct: reviewedCards > 0 ? Math.round((asymptotic / reviewedCards) * 100) : 0 }
  }, [cards, reviewLogs, fsrsData, srsData, algorithm])

  // Irreducible leeches: 5+ lapses, never broke 14d interval, high difficulty
  const irreducibleLeeches = useMemo(() => {
    const byCard = groupLogsByCard(reviewLogs)
    const results: { id: string; front: string; lapses: number; maxInterval: number; difficulty?: number }[] = []

    for (const card of cards) {
      const logs = byCard.get(card.id) ?? []
      const lapseCount = logs.filter(l => l.rating === 1).length
      if (lapseCount < 5) continue
      const maxInterval = logs.reduce((m, l) => Math.max(m, l.scheduledInterval), 0)
      if (maxInterval >= 14) continue

      if (algorithm === 'fsrs') {
        const fs = fsrsData[card.id]
        if (!fs || fs.difficulty <= 7) continue
        results.push({ id: card.id, front: card.front, lapses: lapseCount, maxInterval, difficulty: Math.round(fs.difficulty * 10) / 10 })
      } else {
        const srs = srsData[card.id]
        if (!srs || srs.easeFactor > 1.5) continue
        results.push({ id: card.id, front: card.front, lapses: lapseCount, maxInterval })
      }
    }

    return results.sort((a, b) => b.lapses - a.lapses).slice(0, 8)
  }, [cards, reviewLogs, fsrsData, srsData, algorithm])

  // Memory consolidation events: single reviews that caused stability to jump 3x+
  const consolidationEvents = useMemo(() => {
    const events: { front: string; prevInterval: number; newInterval: number; ratio: number; date: string }[] = []

    for (const card of cards) {
      const logs = (groupLogsByCard(reviewLogs).get(card.id) ?? [])
        .sort((a, b) => new Date(a.reviewedAt).getTime() - new Date(b.reviewedAt).getTime())
      for (let i = 1; i < logs.length; i++) {
        const prev = logs[i - 1], curr = logs[i]
        if (curr.rating < 3 || prev.scheduledInterval < 3) continue
        const ratio = curr.scheduledInterval / prev.scheduledInterval
        if (ratio >= 3) {
          events.push({ front: card.front, prevInterval: prev.scheduledInterval, newInterval: curr.scheduledInterval, ratio: Math.round(ratio * 10) / 10, date: curr.reviewedAt.slice(0, 10) })
        }
      }
    }

    return events.sort((a, b) => b.ratio - a.ratio).slice(0, 8)
  }, [cards, reviewLogs])

  // ════════════════════════════════════════════════════════════════════════════
  // INSIGHTS — Deck & Session Analytics
  // ════════════════════════════════════════════════════════════════════════════

  const deckRetentionDrift = useMemo(() => {
    const results = decks.filter((d) => !d.isArchived).map((deck) => {
      const deckCardIds = new Set(cards.filter((c) => c.deckId === deck.id).map((c) => c.id))
      const deckLogs = reviewLogs.filter((l) => deckCardIds.has(l.cardId))
      const months = Array.from({ length: 3 }, (_, i) => {
        const d = new Date(); d.setMonth(d.getMonth() - (2 - i))
        const month = d.toISOString().slice(0, 7)
        const ml = deckLogs.filter((l) => l.reviewedAt.slice(0, 7) === month)
        if (ml.length < 5) return null
        return { month: month.slice(5), rate: Math.round((ml.filter((l) => l.rating >= 2).length / ml.length) * 100) }
      })
      const valid = months.filter(Boolean) as { month: string; rate: number }[]
      if (valid.length < 2) return null
      return { name: deck.name, months: valid, trend: valid[valid.length - 1].rate - valid[0].rate }
    }).filter(Boolean) as { name: string; months: { month: string; rate: number }[]; trend: number }[]
    return results.sort((a, b) => a.trend - b.trend)
  }, [decks, cards, reviewLogs])

  const difficultyLapseCorr = useMemo(() => {
    if (algorithm !== 'fsrs') return null
    const buckets = [
      { label: '1–3', min: 1, max: 3, lapses: 0, count: 0 },
      { label: '3–5', min: 3, max: 5, lapses: 0, count: 0 },
      { label: '5–7', min: 5, max: 7, lapses: 0, count: 0 },
      { label: '7–9', min: 7, max: 9, lapses: 0, count: 0 },
      { label: '9–10', min: 9, max: 11, lapses: 0, count: 0 },
    ]
    for (const card of cards) {
      const fs = fsrsData[card.id]
      if (!fs || fs.repetitions < 2) continue
      const b = buckets.find((b) => fs.difficulty >= b.min && fs.difficulty < b.max)
      if (b) { b.count++; b.lapses += fs.lapses }
    }
    return buckets.filter((b) => b.count > 0).map((b) => ({ label: b.label, avgLapses: Math.round((b.lapses / b.count) * 10) / 10, count: b.count }))
  }, [cards, fsrsData, algorithm])

  const sessionFatigue = useMemo(() => {
    const bySession = new Map<string, typeof reviewLogs>()
    for (const log of reviewLogs) {
      if (log.sessionId === 'manual') continue
      const list = bySession.get(log.sessionId) ?? []
      list.push(log)
      bySession.set(log.sessionId, list)
    }
    const buckets = [1, 6, 11, 16, 21, 26].map((start) => ({ label: `${start}–${start + 4}`, correct: 0, total: 0 }))
    for (const [, logs] of bySession) {
      const sorted = [...logs].sort((a, b) => new Date(a.reviewedAt).getTime() - new Date(b.reviewedAt).getTime())
      sorted.forEach((log, idx) => {
        const bi = Math.min(Math.floor(idx / 5), buckets.length - 1)
        buckets[bi].total++
        if (log.rating >= 3) buckets[bi].correct++
      })
    }
    return buckets.filter((b) => b.total >= 5).map((b) => ({ label: b.label, rate: Math.round((b.correct / b.total) * 100) }))
  }, [reviewLogs])

  // ════════════════════════════════════════════════════════════════════════════
  // INSIGHTS — Interval Distribution
  // ════════════════════════════════════════════════════════════════════════════

  const firstIntervalSurvival = useMemo(() => {
    const byCard = sortedCardLogs(reviewLogs)
    const buckets = [
      { label: '1d', min: 0, max: 2, survived: 0, total: 0 },
      { label: '2–4d', min: 2, max: 5, survived: 0, total: 0 },
      { label: '5–14d', min: 5, max: 15, survived: 0, total: 0 },
      { label: '15d+', min: 15, max: Infinity, survived: 0, total: 0 },
    ]
    for (const [, logs] of byCard) {
      if (logs.length < 2) continue
      const b = buckets.find((b) => logs[0].scheduledInterval >= b.min && logs[0].scheduledInterval < b.max)
      if (b) { b.total++; if (logs[1].rating >= 2) b.survived++ }
    }
    return buckets.filter((b) => b.total >= 3).map((b) => ({ label: b.label, rate: Math.round((b.survived / b.total) * 100), total: b.total }))
  }, [reviewLogs])

  const maturityCliff = useMemo(() => {
    const buckets = [
      { label: '≤1d', min: 0, max: 1.5, count: 0 },
      { label: '1–7d', min: 1.5, max: 7, count: 0 },
      { label: '1–2w', min: 7, max: 14, count: 0 },
      { label: '2–4w', min: 14, max: 30, count: 0 },
      { label: '1–3m', min: 30, max: 90, count: 0 },
      { label: '3–12m', min: 90, max: 365, count: 0 },
      { label: '1y+', min: 365, max: Infinity, count: 0 },
    ]
    for (const card of cards) {
      let interval: number
      if (algorithm === 'fsrs') {
        const fs = fsrsData[card.id]
        if (!fs || fs.repetitions === 0 || !fs.lastReviewedAt) continue
        interval = (new Date(fs.dueDate).getTime() - new Date(fs.lastReviewedAt).getTime()) / 86400000
      } else {
        const srs = srsData[card.id]
        if (!srs || srs.repetitions === 0) continue
        interval = srs.interval
      }
      const b = buckets.find((b) => interval >= b.min && interval < b.max)
      if (b) b.count++
    }
    return buckets.filter((b) => b.count > 0)
  }, [cards, fsrsData, srsData, algorithm])

  const insightsDataCount = reviewLogs.length

  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div className="max-w-5xl mx-auto space-y-5">

      {/* Burnout banner */}
      {burnoutWarningEnabled && todayDueCount > burnoutThresholdCards && (
        <div className="flex items-center gap-3 bg-yellow-500/10 border border-yellow-500/30 rounded-[var(--radius)] px-4 py-3">
          <AlertTriangle size={16} className="text-yellow-400 shrink-0" />
          <p className="text-sm text-yellow-300">
            Heavy day ahead — <strong>{todayDueCount} cards due</strong>. Consider splitting across days.
          </p>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-[var(--border)] pb-0">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px',
              activeTab === tab.id
                ? 'border-[var(--accent)] text-[var(--accent)]'
                : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Overview tab ── */}
      {activeTab === 'overview' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {overallStats.map(({ label, value, sub, icon: Icon, color }) => (
              <div key={label} className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-[var(--text-muted)]">{label}</span>
                  <Icon size={14} className={color} />
                </div>
                <div className="text-2xl font-bold text-[var(--text-primary)]">{value}</div>
                {sub && <div className="text-xs text-[var(--text-muted)] mt-0.5">{sub}</div>}
              </div>
            ))}
          </div>

          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp size={14} className="text-[var(--text-muted)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Retention Rate — Last 30 Days</h2>
            </div>
            {retentionData.every((d) => d.retention === null) ? (
              <EmptyState message="No reviews yet" />
            ) : (
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={retentionData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} interval={4} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '11px', color: 'var(--text-primary)' }} formatter={(v) => (v == null ? 'No data' : `${v}%`)} />
                  <Line type="monotone" dataKey="retention" stroke="var(--accent)" strokeWidth={2} dot={false} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <TrendingUp size={14} className="text-[var(--text-muted)]" />
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">Review Forecast</h2>
              </div>
              <Badge variant="outline">Next 14 days</Badge>
            </div>
            <div className="flex items-end gap-1.5 h-24">
              {Array.from({ length: 14 }, (_, i) => {
                const ds = dateStr(-i)
                const count = Object.values(srsData).filter((s) => s.dueDate.slice(0, 10) === ds).length
                return { i, count, isToday: i === 0 }
              }).map(({ i, count, isToday }) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex flex-col justify-end" style={{ height: '72px' }}>
                    <div className={`w-full rounded-t-sm transition-colors ${isToday ? 'bg-[var(--danger)]' : 'bg-[var(--bg-active)] hover:bg-[var(--accent)]'}`} style={{ height: `${Math.max(2, (count / 30) * 100)}%` }} title={`${count} cards`} />
                  </div>
                  <span className="text-[8px] text-[var(--text-muted)]">+{i}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-2">Cards due per day based on your SRS schedule</p>
          </div>
        </div>
      )}

      {/* ── Decks tab ── */}
      {activeTab === 'decks' && (
        <div className="space-y-5">
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp size={14} className="text-[var(--text-muted)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Deck Mastery</h2>
            </div>
            {subjectMastery.length === 0 ? <EmptyState message="No decks yet" /> : (
              <div className="space-y-3">
                {subjectMastery.slice(0, 6).map(({ subject, mastery, cards: count }) => (
                  <div key={subject}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-[var(--text-primary)] truncate">{subject}</span>
                      <div className="flex items-center gap-2 ml-2 shrink-0">
                        <span className="text-xs text-[var(--text-muted)]">{count} cards</span>
                        <span className="text-xs font-semibold text-[var(--text-primary)]">{mastery}%</span>
                      </div>
                    </div>
                    <Progress value={mastery} size="sm" color={mastery >= 70 ? 'success' : mastery >= 50 ? 'accent' : mastery >= 30 ? 'warning' : 'danger'} />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 size={14} className="text-[var(--text-muted)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Cards per Deck</h2>
              <span className="text-xs text-[var(--text-muted)] ml-auto">Click to open deck</span>
            </div>
            {deckStats.length === 0 ? <EmptyState message="No decks yet" /> : (
              <div className="space-y-2.5">
                {deckStats.map((deck) => (
                  <button key={deck.id} onClick={() => router.push('/library')} className="w-full text-left group">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-[var(--text-primary)] truncate group-hover:text-[var(--accent)] transition-colors">{deck.name}</span>
                      <div className="flex items-center gap-3 ml-2 shrink-0">
                        <span className="text-xs text-[var(--text-muted)]">{deck.total} cards</span>
                        <span className="text-xs font-medium text-[var(--text-secondary)]">{deck.mastery}% mastery</span>
                      </div>
                    </div>
                    <div className="h-1.5 w-full bg-[var(--bg-active)] rounded-full overflow-hidden">
                      <div className="h-full bg-[var(--accent)] rounded-full transition-all duration-300" style={{ width: `${(deck.total / maxDeckCards) * 100}%` }} />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Reviews tab ── */}
      {activeTab === 'reviews' && (
        <div className="space-y-5">
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 size={14} className="text-[var(--text-muted)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Cards This Week</h2>
            </div>
            {weeklyData.every((d) => d.cards === 0) ? <EmptyState message="No reviews yet this week" /> : (
              <div className="flex items-end gap-2 h-32">
                {weeklyData.map(({ day, cards: count }) => (
                  <div key={day} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex flex-col justify-end" style={{ height: '100px' }}>
                      <div className="w-full bg-[var(--accent)] rounded-t-sm opacity-80 hover:opacity-100 transition-opacity" style={{ height: `${Math.max(2, (count / maxCards) * 100)}%` }} />
                    </div>
                    <span className="text-[9px] text-[var(--text-muted)]">{day}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4">
            <div className="flex items-center gap-2 mb-4">
              <Brain size={14} className="text-[var(--text-muted)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Rating Distribution</h2>
              <span className="text-xs text-[var(--text-muted)] ml-auto">{totalRatings.toLocaleString()} total reviews</span>
            </div>
            {totalRatings === 0 ? <EmptyState message="No reviews yet" /> : (
              <div className="space-y-2.5">
                {ratingLabels.map((label, i) => {
                  const pct = totalRatings > 0 ? Math.round((ratingCounts[i] / totalRatings) * 100) : 0
                  return (
                    <div key={label} className="flex items-center gap-3">
                      <span className={cn('text-xs font-medium w-10 shrink-0', ratingTextColors[i])}>{label}</span>
                      <div className="flex-1 h-2 bg-[var(--bg-active)] rounded-full overflow-hidden">
                        <div className={cn('h-full rounded-full transition-all duration-300', ratingColors[i])} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs text-[var(--text-muted)] w-20 text-right shrink-0">{ratingCounts[i]} ({pct}%)</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4">
            <div className="flex items-center gap-2 mb-4">
              <Clock size={14} className="text-[var(--text-muted)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Average Response Time</h2>
            </div>
            {Object.values(avgResponseByRating).every((v) => v === null) ? <EmptyState message="No timed reviews yet" /> : (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {ratingLabels.map((label, i) => {
                  const secs = avgResponseByRating[i + 1]
                  return (
                    <div key={label} className="bg-[var(--bg-hover)] rounded-[var(--radius-sm)] p-3 text-center">
                      <div className={cn('text-xs font-medium mb-1', ratingTextColors[i])}>{label}</div>
                      <div className="text-lg font-bold text-[var(--text-primary)]">{secs !== null ? `${secs}s` : '—'}</div>
                      <div className="text-[10px] text-[var(--text-muted)] mt-0.5">avg response</div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Habits tab ── */}
      {activeTab === 'habits' && (
        <div className="space-y-5">
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4">
            <div className="flex items-center gap-2 mb-4">
              <Target size={14} className="text-[var(--text-muted)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Study Consistency</h2>
              <span className="text-xs text-[var(--text-muted)] ml-auto">Last 30 days</span>
            </div>
            <div className="flex items-center gap-8">
              <CircleRing value={consistencyScore} size={88} stroke={7} />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-[var(--text-primary)]">{consistencyScore}% consistent</p>
                <p className="text-xs text-[var(--text-muted)]">You studied on {Math.round((consistencyScore / 100) * 30)} out of the last 30 days.</p>
                {consistencyScore >= 80 && <p className="text-xs text-[var(--success)]">Excellent habit — keep it up!</p>}
                {consistencyScore >= 50 && consistencyScore < 80 && <p className="text-xs text-[var(--warning)]">Good progress — try to be more consistent.</p>}
                {consistencyScore < 50 && <p className="text-xs text-[var(--danger)]">Room to improve — try studying daily.</p>}
              </div>
            </div>
          </div>

          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4">
            <div className="flex items-center gap-2 mb-3">
              <Flame size={14} className="text-orange-400" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Current Streak</h2>
            </div>
            <div className="flex items-end gap-2">
              <span className="text-4xl font-bold text-orange-400">{streak}</span>
              <span className="text-sm text-[var(--text-muted)] mb-1">days</span>
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              {streak === 0 ? 'No streak yet — study today to start one!' : streak === 1 ? 'You studied yesterday — keep going!' : `You've been studying for ${streak} days straight.`}
            </p>
          </div>

          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4">
            <div className="flex items-center gap-2 mb-3">
              <Bug size={14} className="text-[var(--danger)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Leech Cards</h2>
              {leechCards.length > 0 && (
                <span className="ml-auto text-xs font-semibold bg-[var(--danger-subtle)] text-[var(--danger)] px-2 py-0.5 rounded-full">
                  {leechCards.length} {leechCards.length === 1 ? 'leech' : 'leeches'}
                </span>
              )}
            </div>
            {leechCards.length === 0 ? <EmptyState message="No leech cards — nice work!" /> : (
              <div className="space-y-1">
                <p className="text-xs text-[var(--text-muted)] mb-2">Cards with {leechThreshold}+ lapses. Consider rewriting or suspending these.</p>
                {leechCards.slice(0, 5).map((card) => (
                  <div key={card.id} className="flex items-center justify-between px-3 py-2 bg-[var(--bg-hover)] rounded-[var(--radius-sm)]">
                    <span className="text-xs text-[var(--text-primary)] truncate max-w-[70%]">{card.front.length > 60 ? card.front.slice(0, 60) + '…' : card.front}</span>
                    <span className="text-xs text-[var(--danger)] font-semibold shrink-0 ml-2">{card.lapses} lapses</span>
                  </div>
                ))}
                {leechCards.length > 5 && <p className="text-xs text-[var(--text-muted)] pt-1">+{leechCards.length - 5} more leeches</p>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Insights tab ── */}
      {activeTab === 'insights' && (
        <div className="space-y-4">
          {insightsDataCount < 20 && (
            <div className="flex items-center gap-3 bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] px-4 py-3">
              <Brain size={14} className="text-[var(--text-muted)] shrink-0" />
              <p className="text-xs text-[var(--text-muted)]">These insights need more review history to be meaningful. Keep studying.</p>
            </div>
          )}

          {/* ── Model & Calibration ── */}
          <SectionDivider label="Model & Calibration" />

          {/* Model calibration: predicted R bucket → actual recall */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4">
            <div className="flex items-center gap-2 mb-1">
              <Target size={14} className="text-[var(--text-muted)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">FSRS Calibration Chart</h2>
            </div>
            <p className="text-xs text-[var(--text-muted)] mb-4">
              Predicted retrievability at review time vs. your actual recall. Bars should align — divergence shows model miscalibration for your brain.
            </p>
            {modelCalibration.length < 2 ? <EmptyState message="Need more paired reviews to compute calibration" /> : (
              <div className="space-y-2.5">
                {modelCalibration.map(({ label, predicted, actual, total }) => (
                  <div key={label}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] text-[var(--text-muted)] w-16 shrink-0">{label} pred.</span>
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[9px] text-[var(--text-muted)] w-12">Predicted</span>
                          <div className="flex-1 h-1.5 bg-[var(--bg-active)] rounded-full overflow-hidden">
                            <div className="h-full bg-sky-500/60 rounded-full" style={{ width: `${predicted}%` }} />
                          </div>
                          <span className="text-[9px] text-sky-400 w-7 text-right">{predicted}%</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[9px] text-[var(--text-muted)] w-12">Actual</span>
                          <div className="flex-1 h-1.5 bg-[var(--bg-active)] rounded-full overflow-hidden">
                            <div className={cn('h-full rounded-full', Math.abs(actual - predicted) <= 5 ? 'bg-[var(--success)]' : actual < predicted - 10 ? 'bg-[var(--danger)]' : 'bg-orange-500')} style={{ width: `${actual}%` }} />
                          </div>
                          <span className="text-[9px] text-[var(--text-secondary)] w-7 text-right">{actual}%</span>
                        </div>
                      </div>
                      <span className="text-[9px] text-[var(--text-muted)] w-14 text-right shrink-0">{total} reviews</span>
                    </div>
                  </div>
                ))}
                <p className="text-[10px] text-[var(--text-muted)] mt-1">Green = calibrated · Orange = model too conservative · Red = model too optimistic</p>
              </div>
            )}
          </div>

          {/* R at lapse distribution */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4">
            <div className="flex items-center gap-2 mb-1">
              <Brain size={14} className="text-[var(--text-muted)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">R at Lapse Distribution</h2>
            </div>
            <p className="text-xs text-[var(--text-muted)] mb-4">
              What retrievability were your cards at when they actually failed? Tells you whether your 0.9 retention target is too high, too low, or right.
            </p>
            {!rAtLapse ? <EmptyState message="Need at least 5 lapse events" /> : (
              <div className="space-y-4">
                <div className="space-y-2">
                  {rAtLapse.buckets.map(({ label, count, pct }) => (
                    <div key={label} className="flex items-center gap-3">
                      <span className="text-xs text-[var(--text-muted)] w-14 shrink-0">{label}</span>
                      <div className="flex-1 h-2 bg-[var(--bg-active)] rounded-full overflow-hidden">
                        <div className={cn('h-full rounded-full', pct >= 30 ? 'bg-[var(--danger)]' : pct >= 15 ? 'bg-orange-500' : 'bg-[var(--accent)]')} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs text-[var(--text-secondary)] w-16 text-right shrink-0">{count} ({pct}%)</span>
                    </div>
                  ))}
                </div>
                <div className="bg-[var(--bg-hover)] rounded-[var(--radius-sm)] px-3 py-2.5">
                  <p className="text-xs text-[var(--text-secondary)]">{rAtLapse.recommendation}</p>
                </div>
              </div>
            )}
          </div>

          {/* ── Review Timing Behavior ── */}
          <SectionDivider label="Review Timing Behavior" />

          {/* Early / late review rates + per-timing pass rates */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock size={14} className="text-[var(--text-muted)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Early vs. Late Review Rates</h2>
            </div>
            <p className="text-xs text-[var(--text-muted)] mb-4">
              How often you review before or after the due date, and how timing affects your pass rate.
            </p>
            {!reviewTiming ? <EmptyState message="Need at least 10 consecutive review pairs" /> : (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Early', rate: reviewTiming.earlyRate, passRate: reviewTiming.earlyPassRate, detail: `avg ${reviewTiming.avgDaysEarly}d early`, icon: ArrowUp, color: 'text-sky-400' },
                    { label: 'On time', rate: reviewTiming.onTimeRate, passRate: reviewTiming.onTimePassRate, detail: '±1.5 days', icon: Target, color: 'text-[var(--success)]' },
                    { label: 'Late', rate: reviewTiming.lateRate, passRate: reviewTiming.latePassRate, detail: `avg ${reviewTiming.avgDaysLate}d late`, icon: ArrowDown, color: 'text-orange-400' },
                  ].map(({ label, rate, passRate, detail, icon: Icon, color }) => (
                    <div key={label} className="bg-[var(--bg-hover)] rounded-[var(--radius-sm)] p-3 text-center">
                      <Icon size={12} className={cn('mx-auto mb-1', color)} />
                      <div className="text-xs text-[var(--text-muted)]">{label}</div>
                      <div className={cn('text-xl font-bold', color)}>{rate}%</div>
                      <div className="text-[10px] text-[var(--text-muted)]">{detail}</div>
                      {passRate !== null && (
                        <div className="text-[10px] text-[var(--text-secondary)] mt-1">{passRate}% pass rate</div>
                      )}
                    </div>
                  ))}
                </div>
                {reviewTiming.optimalWindow && (
                  <div className="bg-[var(--bg-hover)] rounded-[var(--radius-sm)] px-3 py-2">
                    <span className="text-[10px] text-[var(--text-muted)]">Highest pass rate: </span>
                    <span className="text-[10px] font-semibold text-[var(--accent)]">{reviewTiming.optimalWindow}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Optimal review window */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4">
            <div className="flex items-center gap-2 mb-1">
              <Target size={14} className="text-[var(--text-muted)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Optimal Review Window</h2>
            </div>
            <p className="text-xs text-[var(--text-muted)] mb-4">
              Your pass rate broken down by how far off your due date you were. Reveals whether you actually do better 1 day late vs. 3 days early.
            </p>
            {!reviewTiming || reviewTiming.windowBuckets.length < 2 ? <EmptyState message="Need reviews spread across different timing windows" /> : (
              <div className="space-y-2">
                {reviewTiming.windowBuckets.map(({ label, rate, total }, i) => {
                  const isOptimal = label === reviewTiming.optimalWindow
                  return (
                    <div key={label} className="flex items-center gap-3">
                      <span className={cn('text-xs w-24 shrink-0', isOptimal ? 'text-[var(--accent)] font-semibold' : 'text-[var(--text-muted)]')}>{label}</span>
                      <div className="flex-1 h-2 bg-[var(--bg-active)] rounded-full overflow-hidden">
                        <div className={cn('h-full rounded-full', isOptimal ? 'bg-[var(--accent)]' : 'bg-[var(--bg-active)] border-0', rate >= 85 ? 'bg-[var(--success)]' : rate >= 70 ? 'bg-[var(--accent)]' : rate >= 50 ? 'bg-orange-500' : 'bg-[var(--danger)]')} style={{ width: `${rate}%` }} />
                      </div>
                      <span className={cn('text-xs font-semibold w-10 text-right shrink-0', isOptimal ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]')}>{rate}%</span>
                      <span className="text-[10px] text-[var(--text-muted)] w-14 text-right shrink-0">{total} reviews</span>
                    </div>
                  )
                })}
                <p className="text-[10px] text-[var(--text-muted)] pt-1">Highlighted = your personal best recall window</p>
              </div>
            )}
          </div>

          {/* ── Card Health ── */}
          <SectionDivider label="Card Health" />

          {/* Stability loss per lapse */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp size={14} className="text-[var(--text-muted)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Stability Recovery After a Lapse</h2>
            </div>
            <p className="text-xs text-[var(--text-muted)] mb-4">
              After forgetting, how much of the pre-lapse interval does a card recover to on the next successful review? Do young vs. mature cards recover differently?
            </p>
            {stabilityLossPerLapse.every((g) => g.count === 0) ? <EmptyState message="No lapse-recovery pairs yet" /> : (
              <div className="space-y-3">
                {stabilityLossPerLapse.map(({ label, avgRecovery, count }) => (
                  <div key={label}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-[var(--text-primary)]">{label}</span>
                      <div className="flex items-center gap-2 shrink-0 ml-3">
                        <span className="text-xs text-[var(--text-muted)]">{count} lapses</span>
                        <span className={cn('text-xs font-semibold', avgRecovery === null ? 'text-[var(--text-muted)]' : avgRecovery >= 70 ? 'text-[var(--success)]' : avgRecovery >= 40 ? 'text-orange-400' : 'text-[var(--danger)]')}>
                          {avgRecovery !== null ? `${avgRecovery}%` : '—'}
                        </span>
                      </div>
                    </div>
                    {avgRecovery !== null && (
                      <div className="h-1.5 w-full bg-[var(--bg-active)] rounded-full overflow-hidden">
                        <div className={cn('h-full rounded-full', avgRecovery >= 70 ? 'bg-[var(--success)]' : avgRecovery >= 40 ? 'bg-orange-500' : 'bg-[var(--danger)]')} style={{ width: `${avgRecovery}%` }} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Overdue but remembered */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock size={14} className="text-[var(--text-muted)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Overdue But Remembered</h2>
            </div>
            <p className="text-xs text-[var(--text-muted)] mb-4">
              Cards reviewed 15%+ past their due date that you still got right. High rate = FSRS is being too conservative with your intervals.
            </p>
            {overdueStats.rate === null ? <EmptyState message="Not enough overdue reviews yet" /> : (
              <div className="flex items-center gap-8">
                <CircleRing value={overdueStats.rate} size={88} stroke={7} />
                <div className="space-y-1">
                  <p className="text-2xl font-bold text-[var(--text-primary)]">{overdueStats.rate}%</p>
                  <p className="text-xs text-[var(--text-muted)]">{overdueStats.remembered} of {overdueStats.total} overdue reviews passed</p>
                  {overdueStats.rate >= 75 && <p className="text-xs text-sky-400">Your memory outlasts FSRS predictions — consider raising target retention.</p>}
                  {overdueStats.rate >= 50 && overdueStats.rate < 75 && <p className="text-xs text-[var(--warning)]">Reasonable — some overdue cards still stick.</p>}
                  {overdueStats.rate < 50 && <p className="text-xs text-[var(--success)]">Model well-calibrated — late reviews trend toward forgetting.</p>}
                </div>
              </div>
            )}
          </div>

          {/* Lapse clustering */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4">
            <div className="flex items-center gap-2 mb-1">
              <Activity size={14} className="text-[var(--text-muted)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Lapse Clustering</h2>
            </div>
            <p className="text-xs text-[var(--text-muted)] mb-4">
              Are your lapses random (genuine forgetting) or bursty (clustering from fatigue or bad sessions)? CV &gt; 1.2 = bursty.
            </p>
            {!lapseCluster ? <EmptyState message="Need at least 4 lapse events" /> : (
              <div className="space-y-4">
                <div className="flex items-center gap-6">
                  <div>
                    <p className="text-2xl font-bold text-[var(--text-primary)]">{lapseCluster.cv}</p>
                    <p className="text-xs text-[var(--text-muted)]">coefficient of variation</p>
                  </div>
                  <div className={cn('px-3 py-1.5 rounded-[var(--radius-sm)] text-xs font-semibold', lapseCluster.isBursty ? 'bg-orange-500/15 text-orange-400' : 'bg-[var(--success-subtle)] text-[var(--success)]')}>
                    {lapseCluster.isBursty ? 'Bursty — lapses cluster in sessions' : 'Random — lapses spread evenly'}
                  </div>
                  <div className="ml-auto text-right">
                    <p className="text-sm font-semibold text-[var(--text-primary)]">{lapseCluster.totalLapses}</p>
                    <p className="text-xs text-[var(--text-muted)]">total lapses</p>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={80}>
                  <BarChart data={lapseCluster.monthData} margin={{ top: 0, right: 0, left: -30, bottom: 0 }}>
                    <XAxis dataKey="month" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '11px', color: 'var(--text-primary)' }} />
                    <Bar dataKey="lapses" fill="var(--danger)" radius={[2, 2, 0, 0]} opacity={0.7} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Stability flatliners */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4">
            <div className="flex items-center gap-2 mb-1">
              <Zap size={14} className="text-[var(--text-muted)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Stability Flatliners</h2>
            </div>
            <p className="text-xs text-[var(--text-muted)] mb-4">
              Cards with 5+ reviews but {algorithm === 'fsrs' ? 'stability < 10 days — never making it to long-term memory' : 'ease factor stuck near minimum'}.
            </p>
            {stabilityFlatliners.length === 0 ? <EmptyState message="No flatliners — your cards are progressing well!" /> : (
              <div className="space-y-1.5">
                {stabilityFlatliners.map((card) => (
                  <div key={card.id} className="flex items-center justify-between px-3 py-2 bg-[var(--bg-hover)] rounded-[var(--radius-sm)]">
                    <span className="text-xs text-[var(--text-primary)] truncate max-w-[55%]">{card.front.length > 55 ? card.front.slice(0, 55) + '…' : card.front}</span>
                    <div className="flex items-center gap-3 shrink-0 ml-2">
                      <span className="text-[10px] text-[var(--text-muted)]">{card.reps} reps</span>
                      <span className="text-xs text-orange-400 font-semibold">{card.metricLabel === 'stability' ? `${card.metric}d` : `ease ${card.metric}`}</span>
                    </div>
                  </div>
                ))}
                <p className="text-[10px] text-[var(--text-muted)] pt-1">Consider rewriting these as more atomic cards.</p>
              </div>
            )}
          </div>

          {/* ── Long-term Memory Architecture ── */}
          <SectionDivider label="Long-term Memory Architecture" />

          {/* Mature card attrition */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp size={14} className="text-[var(--text-muted)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Mature Card Attrition</h2>
            </div>
            <p className="text-xs text-[var(--text-muted)] mb-4">
              Of cards that hit a 21+ day interval, what % eventually lapsed back? And at what stability does that usually happen?
            </p>
            {!matureAttrition ? <EmptyState message="Need cards that have reached 21+ day intervals" /> : (
              <div className="space-y-4">
                <div className="flex items-center gap-6">
                  <div>
                    <p className="text-2xl font-bold text-[var(--text-primary)]">{matureAttrition.attritionRate}%</p>
                    <p className="text-xs text-[var(--text-muted)]">attrition rate</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-xs text-[var(--text-secondary)]">{matureAttrition.attritionCount} of {matureAttrition.matureCards} mature cards lapsed back</p>
                    {matureAttrition.avgLapseS && (
                      <p className="text-xs text-[var(--text-muted)]">Avg stability at lapse: {matureAttrition.avgLapseS}d</p>
                    )}
                  </div>
                </div>
                {matureAttrition.sBuckets.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] text-[var(--text-muted)]">Lapse distribution by stability range</p>
                    {matureAttrition.sBuckets.map(({ label, count }) => (
                      <div key={label} className="flex items-center gap-3">
                        <span className="text-[10px] text-[var(--text-muted)] w-20 shrink-0">{label}</span>
                        <div className="flex-1 h-1.5 bg-[var(--bg-active)] rounded-full overflow-hidden">
                          <div className="h-full bg-[var(--danger)] rounded-full opacity-70" style={{ width: `${Math.min(100, count * 20)}%` }} />
                        </div>
                        <span className="text-[10px] text-[var(--text-muted)] w-12 text-right">{count} lapses</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Asymptotic learners */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4">
            <div className="flex items-center gap-2 mb-1">
              <Target size={14} className="text-[var(--text-muted)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Asymptotic Learners</h2>
            </div>
            <p className="text-xs text-[var(--text-muted)] mb-4">
              Cards with zero lapses and a 30+ day interval. These are "permanently known" — your deck's solid foundation.
            </p>
            {asymptoticLearners.total === 0 ? <EmptyState message="No reviewed cards yet" /> : (
              <div className="flex items-center gap-8">
                <CircleRing value={asymptoticLearners.pct} size={88} stroke={7} />
                <div className="space-y-1">
                  <p className="text-2xl font-bold text-[var(--text-primary)]">{asymptoticLearners.count}</p>
                  <p className="text-xs text-[var(--text-muted)]">of {asymptoticLearners.total} reviewed cards are asymptotic</p>
                  <p className="text-xs text-[var(--text-muted)]">{asymptoticLearners.pct}% of your reviewed deck is permanently known</p>
                  {asymptoticLearners.pct >= 30 && <p className="text-xs text-[var(--success)]">Strong foundation — most of your deck has stuck.</p>}
                  {asymptoticLearners.pct < 10 && asymptoticLearners.total > 10 && <p className="text-xs text-[var(--warning)]">Few cards have hit long-term retention yet.</p>}
                </div>
              </div>
            )}
          </div>

          {/* Irreducible leeches */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4">
            <div className="flex items-center gap-2 mb-1">
              <Bug size={14} className="text-[var(--danger)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Irreducible Leeches</h2>
            </div>
            <p className="text-xs text-[var(--text-muted)] mb-4">
              Cards with 5+ lapses, never broke a 14-day interval, and {algorithm === 'fsrs' ? 'D > 7' : 'ease < 1.5'}. True cognitive dead weight — worth deleting or rewriting.
            </p>
            {irreducibleLeeches.length === 0 ? <EmptyState message="No irreducible leeches found" /> : (
              <div className="space-y-1.5">
                {irreducibleLeeches.map((card) => (
                  <div key={card.id} className="flex items-center justify-between px-3 py-2 bg-[var(--danger-subtle)] rounded-[var(--radius-sm)]">
                    <span className="text-xs text-[var(--text-primary)] truncate max-w-[55%]">{card.front.length > 55 ? card.front.slice(0, 55) + '…' : card.front}</span>
                    <div className="flex items-center gap-3 shrink-0 ml-2">
                      <span className="text-[10px] text-[var(--text-muted)]">max {card.maxInterval}d</span>
                      {card.difficulty && <span className="text-[10px] text-orange-400">D={card.difficulty}</span>}
                      <span className="text-xs text-[var(--danger)] font-semibold">{card.lapses} lapses</span>
                    </div>
                  </div>
                ))}
                <p className="text-[10px] text-[var(--text-muted)] pt-1">These cards have never consolidated despite many attempts.</p>
              </div>
            )}
          </div>

          {/* Memory consolidation events */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4">
            <div className="flex items-center gap-2 mb-1">
              <Zap size={14} className="text-sky-400" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Memory Consolidation Events</h2>
            </div>
            <p className="text-xs text-[var(--text-muted)] mb-4">
              Reviews where a card's interval jumped 3x or more in one go. These correlate with good sleep, active recall, or spacing hitting the sweet spot.
            </p>
            {consolidationEvents.length === 0 ? <EmptyState message="No consolidation events detected yet (need 3x interval jumps)" /> : (
              <div className="space-y-1.5">
                {consolidationEvents.map((ev, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2 bg-[var(--bg-hover)] rounded-[var(--radius-sm)]">
                    <span className="text-xs text-[var(--text-primary)] truncate max-w-[50%]">{ev.front.length > 50 ? ev.front.slice(0, 50) + '…' : ev.front}</span>
                    <div className="flex items-center gap-3 shrink-0 ml-2">
                      <span className="text-[10px] text-[var(--text-muted)]">{ev.prevInterval}d → {ev.newInterval}d</span>
                      <span className="text-xs text-sky-400 font-semibold">{ev.ratio}×</span>
                      <span className="text-[10px] text-[var(--text-muted)]">{ev.date}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Deck & Session Analytics ── */}
          <SectionDivider label="Deck & Session Analytics" />

          {/* Per-deck retention drift */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4">
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 size={14} className="text-[var(--text-muted)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Per-Deck Retention Drift</h2>
            </div>
            <p className="text-xs text-[var(--text-muted)] mb-4">
              Is a deck's recall rate trending up or down over the last 3 months? Sorted worst drift first.
            </p>
            {deckRetentionDrift.length === 0 ? <EmptyState message="Need 3+ months of data per deck (5+ reviews/month)" /> : (
              <div className="space-y-3">
                {deckRetentionDrift.slice(0, 5).map(({ name, months, trend }) => (
                  <div key={name}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-[var(--text-primary)] truncate max-w-[45%]">{name}</span>
                      <div className="flex items-center gap-3 shrink-0 ml-2">
                        <div className="flex gap-2">{months.map((m) => <span key={m.month} className="text-[9px] text-[var(--text-muted)]">{m.month}: {m.rate}%</span>)}</div>
                        <span className={cn('text-xs font-semibold', trend > 0 ? 'text-[var(--success)]' : trend < -5 ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]')}>
                          {trend > 0 ? `+${trend}pp` : `${trend}pp`}
                        </span>
                      </div>
                    </div>
                    <div className="h-1.5 w-full bg-[var(--bg-active)] rounded-full overflow-hidden">
                      <div className={cn('h-full rounded-full', trend > 0 ? 'bg-[var(--success)]' : trend < -5 ? 'bg-[var(--danger)]' : 'bg-[var(--accent)]')} style={{ width: `${months[months.length - 1].rate}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Difficulty vs lapse rate — FSRS only */}
          {algorithm === 'fsrs' && (
            <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4">
              <div className="flex items-center gap-2 mb-1">
                <Brain size={14} className="text-[var(--text-muted)]" />
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">Difficulty vs. Actual Lapse Rate</h2>
              </div>
              <p className="text-xs text-[var(--text-muted)] mb-4">
                Does FSRS-5's D score predict which cards you forget? Bars should rise left-to-right if well-calibrated.
              </p>
              {!difficultyLapseCorr || difficultyLapseCorr.length < 2 ? <EmptyState message="Need more FSRS cards with reviews" /> : (
                <ResponsiveContainer width="100%" height={120}>
                  <BarChart data={difficultyLapseCorr} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '11px', color: 'var(--text-primary)' }} formatter={(v, _, p) => [`${v} avg lapses (${p.payload.count} cards)`, 'Difficulty']} />
                    <Bar dataKey="avgLapses" radius={[3, 3, 0, 0]}>
                      {difficultyLapseCorr.map((_, i) => <Cell key={i} fill={`hsl(${220 - i * 30}, 70%, 60%)`} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          )}

          {/* Session fatigue */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4">
            <div className="flex items-center gap-2 mb-1">
              <Flame size={14} className="text-[var(--text-muted)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Session Fatigue Threshold</h2>
            </div>
            <p className="text-xs text-[var(--text-muted)] mb-4">
              Your Good/Easy rate by card position within a session. The position where it drops is your fatigue threshold.
            </p>
            {sessionFatigue.length < 2 ? <EmptyState message="Need more session data" /> : (
              <div className="space-y-2">
                {sessionFatigue.map(({ label, rate }, i) => {
                  const isDropping = i > 0 && rate < sessionFatigue[i - 1].rate - 5
                  return (
                    <div key={label} className="flex items-center gap-3">
                      <span className="text-xs text-[var(--text-muted)] w-14 shrink-0">Card {label}</span>
                      <div className="flex-1 h-2 bg-[var(--bg-active)] rounded-full overflow-hidden">
                        <div className={cn('h-full rounded-full transition-all', isDropping ? 'bg-orange-500' : rate >= 80 ? 'bg-[var(--success)]' : 'bg-[var(--accent)]')} style={{ width: `${rate}%` }} />
                      </div>
                      <span className={cn('text-xs font-semibold w-10 text-right shrink-0', isDropping ? 'text-orange-400' : 'text-[var(--text-secondary)]')}>{rate}%</span>
                    </div>
                  )
                })}
                <p className="text-[10px] text-[var(--text-muted)] pt-1">Orange = notable drop from previous position</p>
              </div>
            )}
          </div>

          {/* ── Interval Distribution ── */}
          <SectionDivider label="Interval Distribution" />

          {/* First-interval survival */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4">
            <div className="flex items-center gap-2 mb-1">
              <Target size={14} className="text-[var(--text-muted)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">First-Interval Survival Rate</h2>
            </div>
            <p className="text-xs text-[var(--text-muted)] mb-4">
              What % of cards survive their first review without lapsing, broken down by how long that first interval was.
            </p>
            {firstIntervalSurvival.length === 0 ? <EmptyState message="Need cards with at least 2 reviews" /> : (
              <div className="space-y-2.5">
                {firstIntervalSurvival.map(({ label, rate, total }) => (
                  <div key={label} className="flex items-center gap-3">
                    <span className="text-xs text-[var(--text-muted)] w-16 shrink-0">{label} first</span>
                    <div className="flex-1 h-2 bg-[var(--bg-active)] rounded-full overflow-hidden">
                      <div className={cn('h-full rounded-full', rate >= 80 ? 'bg-[var(--success)]' : rate >= 60 ? 'bg-[var(--accent)]' : 'bg-[var(--danger)]')} style={{ width: `${rate}%` }} />
                    </div>
                    <span className="text-xs font-semibold text-[var(--text-secondary)] w-10 text-right shrink-0">{rate}%</span>
                    <span className="text-[10px] text-[var(--text-muted)] w-16 text-right shrink-0">{total} cards</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Maturity cliff */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4">
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 size={14} className="text-[var(--text-muted)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Maturity Cliff</h2>
            </div>
            <p className="text-xs text-[var(--text-muted)] mb-4">
              Distribution of current card intervals. The sharp drop is where cards get "abandoned" as learned-enough.
            </p>
            {maturityCliff.length === 0 ? <EmptyState message="No reviewed cards yet" /> : (
              <ResponsiveContainer width="100%" height={120}>
                <BarChart data={maturityCliff} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '11px', color: 'var(--text-primary)' }} formatter={(v) => [`${v} cards`, 'Count']} />
                  <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                    {maturityCliff.map((_, i) => <Cell key={i} fill={`hsl(220, 70%, ${45 + i * 7}%)`} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

        </div>
      )}
    </div>
  )
}
