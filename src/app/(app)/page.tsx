'use client'

import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { StatsOverview } from '@/components/dashboard/StatsOverview'
import { StreakHeatmap } from '@/components/dashboard/StreakHeatmap'
import { PeriodStats } from '@/components/dashboard/PeriodStats'
import { DailyQueue } from '@/components/dashboard/DailyQueue'
import { ExamCountdowns } from '@/components/dashboard/ExamCountdowns'
import { HardestTopics } from '@/components/dashboard/HardestTopics'
import { PERIOD_OPTIONS, type Period } from '@/lib/periods'
import { cn } from '@/lib/utils'

export default function DashboardPage() {
  const [period, setPeriod] = useState<Period>('today')
  const [open, setOpen] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)

  const currentLabel = PERIOD_OPTIONS.find((o) => o.value === period)?.label ?? 'Today'

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="flex-1 overflow-y-auto px-8 py-6">
      <p className="text-xs text-[var(--text-muted)] mb-1">Dashboard</p>

      {/* Title + period picker */}
      <div className="flex items-center gap-2 mb-6" ref={dropRef}>
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">{currentLabel}</h1>
        <div className="relative">
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            <ChevronDown size={18} className={cn('transition-transform duration-150', open && 'rotate-180')} />
          </button>

          {open && (
            <div className="absolute left-0 top-7 z-50 w-40 bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-xl overflow-hidden animate-scale-in">
              {PERIOD_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => { setPeriod(opt.value); setOpen(false) }}
                  className={cn(
                    'w-full flex items-center justify-between px-3 py-2 text-sm text-left transition-colors',
                    period === opt.value
                      ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
                      : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                  )}
                >
                  {opt.label}
                  {period === opt.value && <Check size={13} />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Stats — filtered by selected period */}
      <StatsOverview period={period} />

      {/* Due-now queue */}
      <DailyQueue />

      {/* Overview */}
      <div className="mt-8">
        <h2 className="text-base font-semibold text-[var(--text-primary)] mb-4">Overview</h2>
        <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-2">Review Activity</h3>
        <StreakHeatmap />
        <PeriodStats period={period} />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-6">
          <ExamCountdowns />
          <HardestTopics />
        </div>
      </div>
    </div>
  )
}
