'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { StatsOverview } from '@/components/dashboard/StatsOverview'
import { StreakHeatmap } from '@/components/dashboard/StreakHeatmap'
import { PeriodStats } from '@/components/dashboard/PeriodStats'
import { DailyQueue } from '@/components/dashboard/DailyQueue'
import { ExamCountdowns } from '@/components/dashboard/ExamCountdowns'
import { HardestTopics } from '@/components/dashboard/HardestTopics'
import { useLibraryStore } from '@/store/useLibraryStore'
import { useHistoryStore } from '@/store/useHistoryStore'
import { useSettingsStore } from '@/store/useSettingsStore'
import { PERIOD_OPTIONS, type Period } from '@/lib/periods'
import { cn } from '@/lib/utils'

export default function DashboardPage() {
  const [period, setPeriod] = useState<Period>('today')
  const [open, setOpen] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)

  const { cards, decks, fsrsData, getDueCards } = useLibraryStore(
    useShallow((s) => ({
      cards: s.cards,
      decks: s.decks,
      fsrsData: s.fsrsData,
      getDueCards: s.getDueCards,
    }))
  )
  const reviewLogs = useHistoryStore((s) => s.reviewLogs)
  const newCardsPerDay = useSettingsStore((s) => s.newCardsPerDay)

  // Same queue count the sidebar Inbox badge shows — surfaced here as the
  // Stitch welcome sub-line.
  const dueCount = useMemo(
    () => getDueCards().length,
    [cards, decks, fsrsData, reviewLogs, newCardsPerDay, getDueCards]
  )

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
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-[1200px] mx-auto px-6 py-10 space-y-8 pb-16">
        {/* Welcome header — Stitch dashboard hero row */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--text-primary)] tracking-tight">Welcome back.</h1>
            <p className="text-[15px] text-[var(--text-secondary)] mt-1">
              {dueCount > 0 ? (
                <>You have <span className="text-[var(--accent)] font-bold">{dueCount} {dueCount === 1 ? 'card' : 'cards'}</span> scheduled for today.</>
              ) : (
                <>You&apos;re all caught up for today.</>
              )}
            </p>
          </div>

          {/* Period picker for the stat tiles below */}
          <div className="relative shrink-0" ref={dropRef}>
            <button
              onClick={() => setOpen((v) => !v)}
              className="flex items-center gap-2 px-4 h-10 rounded-[var(--radius)] bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              <span className="font-mono text-[13px]">{currentLabel}</span>
              <ChevronDown size={15} className={cn('text-[var(--text-muted)] transition-transform duration-150', open && 'rotate-180')} />
            </button>

            {open && (
              <div className="absolute right-0 top-12 z-50 w-44 bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] shadow-[var(--shadow-popover)] overflow-hidden animate-scale-in">
                {PERIOD_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => { setPeriod(opt.value); setOpen(false) }}
                    className={cn(
                      'w-full flex items-center justify-between px-4 py-2.5 text-sm text-left transition-colors',
                      period === opt.value
                        ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
                        : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                    )}
                  >
                    {opt.label}
                    {period === opt.value && <Check size={14} />}
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

        {/* Activity heatmap */}
        <StreakHeatmap />

        <PeriodStats period={period} />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ExamCountdowns />
          <HardestTopics />
        </div>
      </div>
    </div>
  )
}
