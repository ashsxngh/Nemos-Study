'use client'

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  BarChart3, TrendingUp, Brain, Clock, Flame, Target, AlertTriangle, Bug
} from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer
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
    if (target === 0) {
      setCount(0)
      return
    }
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

// ── Circular progress ring ─────────────────────────────────────────────────

interface RingProps {
  value: number // 0-100
  size?: number
  stroke?: number
  label?: string
}

function CircleRing({ value, size = 96, stroke = 8, label }: RingProps) {
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const offset = circ - (value / 100) * circ
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--bg-active)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={stroke}
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
      </svg>
      <span className="text-2xl font-bold text-[var(--text-primary)]" style={{ marginTop: `-${size / 2 + 12}px`, position: 'relative', zIndex: 1, lineHeight: 1 }}>
        {Math.round(value)}
      </span>
      {label && <span className="text-xs text-[var(--text-muted)] mt-0.5">{label}</span>}
    </div>
  )
}

// ── Tab bar ───────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'decks', label: 'Decks' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'habits', label: 'Habits' },
]

// ── Main ──────────────────────────────────────────────────────────────────────

export function StatsPage() {
  const [activeTab, setActiveTab] = useState('overview')
  const router = useRouter()

  const { cards, decks, sessions, reviewLogs, getDeckMastery } = useLibraryStore()
  const srsData = useLibraryStore((s) => s.srsData)
  const { burnoutWarningEnabled, burnoutThresholdCards, leechThreshold } = useSettingsStore()

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

  // ── Today's due count (for burnout banner) ────────────────────────────────
  const todayStr = new Date().toISOString().slice(0, 10)
  const todayDueCount = useMemo(
    () => Object.values(srsData).filter((s) => s.dueDate.slice(0, 10) <= todayStr).length,
    [srsData, todayStr]
  )

  // ── Retention: last 30 days ───────────────────────────────────────────────
  const retentionData = useMemo(() => {
    return Array.from({ length: 30 }, (_, i) => {
      const ds = dateStr(29 - i)
      const dayLogs = reviewLogs.filter((l) => l.reviewedAt.slice(0, 10) === ds)
      if (dayLogs.length === 0) return { date: shortDate(ds), retention: null }
      const correct = dayLogs.filter((l) => l.rating >= 3).length
      return { date: shortDate(ds), retention: Math.round((correct / dayLogs.length) * 100) }
    })
  }, [reviewLogs])

  // ── Rating distribution ────────────────────────────────────────────────────
  const ratingCounts = useMemo(() => {
    const counts = [0, 0, 0, 0] // indices 0-3 → ratings 1-4
    reviewLogs.forEach((l) => { counts[l.rating - 1]++ })
    return counts
  }, [reviewLogs])
  const totalRatings = ratingCounts.reduce((a, b) => a + b, 0)

  // ── Average response time by rating ──────────────────────────────────────
  const avgResponseByRating = useMemo(() => {
    const byRating: Record<number, number[]> = { 1: [], 2: [], 3: [], 4: [] }
    reviewLogs.forEach((l) => {
      if (l.responseMs > 0) byRating[l.rating].push(l.responseMs)
    })
    return Object.fromEntries(
      Object.entries(byRating).map(([r, ms]) => [
        r,
        ms.length > 0 ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length / 1000) : null,
      ])
    ) as Record<number, number | null>
  }, [reviewLogs])

  // ── Cards per deck ─────────────────────────────────────────────────────────
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

  // ── Consistency score ─────────────────────────────────────────────────────
  const consistencyScore = useMemo(() => {
    const studiedDays = new Set(
      reviewLogs
        .filter((l) => {
          const daysAgo = (Date.now() - new Date(l.reviewedAt).getTime()) / 86400000
          return daysAgo <= 30
        })
        .map((l) => l.reviewedAt.slice(0, 10))
    ).size
    return Math.round((studiedDays / 30) * 100)
  }, [reviewLogs])

  // ── Leech cards ───────────────────────────────────────────────────────────
  const leechCards = useMemo(() => {
    return cards
      .filter((c) => (srsData[c.id]?.lapses ?? 0) >= leechThreshold)
      .map((c) => ({ id: c.id, front: c.front, lapses: srsData[c.id]?.lapses ?? 0 }))
      .sort((a, b) => b.lapses - a.lapses)
  }, [cards, srsData, leechThreshold])

  // ── Weekly chart data ─────────────────────────────────────────────────────
  const weeklyData = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const ds = dateStr(6 - i)
      const d = new Date(ds)
      const count = reviewLogs.filter((l) => l.reviewedAt.slice(0, 10) === ds).length
      return { day: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()], cards: count }
    })
  }, [reviewLogs])
  const maxCards = Math.max(...weeklyData.map((d) => d.cards), 1)

  // ── Subject mastery list ──────────────────────────────────────────────────
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

  // ── Animated stat numbers ─────────────────────────────────────────────────
  const animatedTotalCards = useCountUp(totalCards)
  const animatedMastered = useCountUp(masteredCards)
  const animatedMonthMinutes = useCountUp(monthMinutes)
  const animatedStreak = useCountUp(streak)
  const animatedMonthHours = useCountUp(Math.floor(monthMinutes / 60))
  const animatedMonthRem = useCountUp(monthMinutes % 60)

  const studyTimeStr =
    monthMinutes >= 60
      ? `${animatedMonthHours}h ${animatedMonthRem}m`
      : `${animatedMonthMinutes}m`

  const overallStats = [
    { label: 'Total cards', value: String(animatedTotalCards), icon: Brain, color: 'text-[var(--accent)]' },
    { label: 'Cards mastered', value: String(animatedMastered), sub: totalCards > 0 ? `${Math.round((masteredCards / totalCards) * 100)}%` : '0%', icon: Target, color: 'text-[var(--success)]' },
    { label: 'Study time', value: studyTimeStr, sub: 'this month', icon: Clock, color: 'text-sky-400' },
    { label: 'Current streak', value: String(animatedStreak), sub: 'days', icon: Flame, color: 'text-orange-400' },
  ]

  const ratingLabels = ['Again', 'Hard', 'Good', 'Easy']
  const ratingColors = [
    'bg-red-500',
    'bg-orange-500',
    'bg-[var(--accent)]',
    'bg-[var(--success)]',
  ]
  const ratingTextColors = [
    'text-red-400',
    'text-orange-400',
    'text-[var(--accent)]',
    'text-[var(--success)]',
  ]

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
          {/* 4-card stat grid */}
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

          {/* Retention line chart */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp size={14} className="text-[var(--text-muted)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Retention Rate — Last 30 Days</h2>
            </div>
            {retentionData.every((d) => d.retention === null) ? (
              <div className="h-36 flex items-center justify-center text-xs text-[var(--text-muted)]">
                No reviews yet
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={retentionData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
                    interval={4}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fontSize: 9, fill: 'var(--text-muted)' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border)',
                      borderRadius: '6px',
                      fontSize: '11px',
                      color: 'var(--text-primary)',
                    }}
                    formatter={(v) => (v == null ? 'No data' : `${v}%`)}
                  />
                  <Line
                    type="monotone"
                    dataKey="retention"
                    stroke="var(--accent)"
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Review forecast */}
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
                    <div
                      className={`w-full rounded-t-sm transition-colors ${isToday ? 'bg-[var(--danger)]' : 'bg-[var(--bg-active)] hover:bg-[var(--accent)]'}`}
                      style={{ height: `${Math.max(2, (count / 30) * 100)}%` }}
                      title={`${count} cards`}
                    />
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
          {/* Deck mastery overview */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp size={14} className="text-[var(--text-muted)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Deck Mastery</h2>
            </div>
            {subjectMastery.length === 0 ? (
              <div className="flex items-center justify-center h-24 text-xs text-[var(--text-muted)]">No decks yet</div>
            ) : (
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
                    <Progress
                      value={mastery}
                      size="sm"
                      color={mastery >= 70 ? 'success' : mastery >= 50 ? 'accent' : mastery >= 30 ? 'warning' : 'danger'}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Cards per deck horizontal bar chart */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 size={14} className="text-[var(--text-muted)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Cards per Deck</h2>
              <span className="text-xs text-[var(--text-muted)] ml-auto">Click to open deck</span>
            </div>
            {deckStats.length === 0 ? (
              <div className="flex items-center justify-center h-24 text-xs text-[var(--text-muted)]">No decks yet</div>
            ) : (
              <div className="space-y-2.5">
                {deckStats.map((deck) => (
                  <button
                    key={deck.id}
                    onClick={() => router.push('/library')}
                    className="w-full text-left group"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-[var(--text-primary)] truncate group-hover:text-[var(--accent)] transition-colors">
                        {deck.name}
                      </span>
                      <div className="flex items-center gap-3 ml-2 shrink-0">
                        <span className="text-xs text-[var(--text-muted)]">{deck.total} cards</span>
                        <span className="text-xs font-medium text-[var(--text-secondary)]">{deck.mastery}% mastery</span>
                      </div>
                    </div>
                    <div className="h-1.5 w-full bg-[var(--bg-active)] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[var(--accent)] rounded-full transition-all duration-300"
                        style={{ width: `${(deck.total / maxDeckCards) * 100}%` }}
                      />
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
          {/* Weekly chart */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 size={14} className="text-[var(--text-muted)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Cards This Week</h2>
            </div>
            {weeklyData.every((d) => d.cards === 0) ? (
              <div className="h-32 flex items-center justify-center text-xs text-[var(--text-muted)]">No reviews yet this week</div>
            ) : (
              <div className="flex items-end gap-2 h-32">
                {weeklyData.map(({ day, cards: count }) => (
                  <div key={day} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex flex-col justify-end" style={{ height: '100px' }}>
                      <div
                        className="w-full bg-[var(--accent)] rounded-t-sm opacity-80 hover:opacity-100 transition-opacity"
                        style={{ height: `${Math.max(2, (count / maxCards) * 100)}%` }}
                      />
                    </div>
                    <span className="text-[9px] text-[var(--text-muted)]">{day}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Rating distribution */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4">
            <div className="flex items-center gap-2 mb-4">
              <Brain size={14} className="text-[var(--text-muted)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Rating Distribution</h2>
              <span className="text-xs text-[var(--text-muted)] ml-auto">{totalRatings.toLocaleString()} total reviews</span>
            </div>
            {totalRatings === 0 ? (
              <div className="flex items-center justify-center h-16 text-xs text-[var(--text-muted)]">No reviews yet</div>
            ) : (
              <div className="space-y-2.5">
                {ratingLabels.map((label, i) => {
                  const pct = totalRatings > 0 ? Math.round((ratingCounts[i] / totalRatings) * 100) : 0
                  return (
                    <div key={label} className="flex items-center gap-3">
                      <span className={cn('text-xs font-medium w-10 shrink-0', ratingTextColors[i])}>{label}</span>
                      <div className="flex-1 h-2 bg-[var(--bg-active)] rounded-full overflow-hidden">
                        <div
                          className={cn('h-full rounded-full transition-all duration-300', ratingColors[i])}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs text-[var(--text-muted)] w-20 text-right shrink-0">
                        {ratingCounts[i]} ({pct}%)
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Average response time */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4">
            <div className="flex items-center gap-2 mb-4">
              <Clock size={14} className="text-[var(--text-muted)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Average Response Time</h2>
            </div>
            {Object.values(avgResponseByRating).every((v) => v === null) ? (
              <div className="flex items-center justify-center h-16 text-xs text-[var(--text-muted)]">No timed reviews yet</div>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {ratingLabels.map((label, i) => {
                  const secs = avgResponseByRating[i + 1]
                  return (
                    <div key={label} className="bg-[var(--bg-hover)] rounded-[var(--radius-sm)] p-3 text-center">
                      <div className={cn('text-xs font-medium mb-1', ratingTextColors[i])}>{label}</div>
                      <div className="text-lg font-bold text-[var(--text-primary)]">
                        {secs !== null ? `${secs}s` : '—'}
                      </div>
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
          {/* Consistency score */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4">
            <div className="flex items-center gap-2 mb-4">
              <Target size={14} className="text-[var(--text-muted)]" />
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Study Consistency</h2>
              <span className="text-xs text-[var(--text-muted)] ml-auto">Last 30 days</span>
            </div>
            <div className="flex items-center gap-8">
              <div className="relative flex items-center justify-center" style={{ width: 96, height: 96 }}>
                <CircleRing value={consistencyScore} size={96} stroke={8} />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-[var(--text-primary)]">{consistencyScore}% consistent</p>
                <p className="text-xs text-[var(--text-muted)]">
                  You studied on {Math.round((consistencyScore / 100) * 30)} out of the last 30 days.
                </p>
                {consistencyScore >= 80 && (
                  <p className="text-xs text-[var(--success)]">Excellent habit — keep it up!</p>
                )}
                {consistencyScore >= 50 && consistencyScore < 80 && (
                  <p className="text-xs text-[var(--warning)]">Good progress — try to be more consistent.</p>
                )}
                {consistencyScore < 50 && (
                  <p className="text-xs text-[var(--danger)]">Room to improve — try studying daily.</p>
                )}
              </div>
            </div>
          </div>

          {/* Streak */}
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
              {streak === 0
                ? 'No streak yet — study today to start one!'
                : streak === 1
                ? 'You studied yesterday — keep going!'
                : `You've been studying for ${streak} days straight.`}
            </p>
          </div>

          {/* Leech cards */}
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
            {leechCards.length === 0 ? (
              <div className="flex items-center justify-center h-12 text-xs text-[var(--text-muted)]">
                No leech cards — nice work!
              </div>
            ) : (
              <div className="space-y-1">
                <p className="text-xs text-[var(--text-muted)] mb-2">
                  Cards with {leechThreshold}+ lapses. Consider rewriting or suspending these.
                </p>
                {leechCards.slice(0, 5).map((card) => (
                  <div
                    key={card.id}
                    className="flex items-center justify-between px-3 py-2 bg-[var(--bg-hover)] rounded-[var(--radius-sm)]"
                  >
                    <span className="text-xs text-[var(--text-primary)] truncate max-w-[70%]">
                      {card.front.length > 60 ? card.front.slice(0, 60) + '…' : card.front}
                    </span>
                    <span className="text-xs text-[var(--danger)] font-semibold shrink-0 ml-2">
                      {card.lapses} lapses
                    </span>
                  </div>
                ))}
                {leechCards.length > 5 && (
                  <p className="text-xs text-[var(--text-muted)] pt-1">
                    +{leechCards.length - 5} more leeches
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
