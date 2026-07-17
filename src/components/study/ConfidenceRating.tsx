'use client'

import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '@/lib/utils'
import { fsrsSchedule, DEFAULT_FSRS_PARAMS, type FSRSState } from '@/lib/srs'
import { useSettingsStore } from '@/store/useSettingsStore'
import type { Difficulty } from '@/lib/types'

interface RatingOption {
  rating: Difficulty
  label: string
  colorClass: string
  bgClass: string
  borderClass: string
  hoverClass: string
}

const RATINGS: RatingOption[] = [
  {
    rating: 1,
    label: 'Missed',
    colorClass: 'text-[var(--text-secondary)]',
    bgClass: 'bg-[var(--bg-active)]',
    borderClass: 'border-[var(--border-strong)]',
    hoverClass: 'hover:bg-[var(--bg-active)] hover:text-[var(--text-primary)]',
  },
  {
    rating: 2,
    label: 'Hard',
    colorClass: 'text-[var(--warning)]',
    bgClass: 'bg-[var(--warning-subtle)]',
    borderClass: 'border-[var(--warning)]',
    hoverClass: 'hover:bg-[var(--warning)] hover:text-[var(--warning-fg)]',
  },
  {
    rating: 3,
    label: 'Good',
    colorClass: 'text-[var(--accent)]',
    bgClass: 'bg-[var(--accent-subtle)]',
    borderClass: 'border-[var(--accent)]',
    hoverClass: 'hover:bg-[var(--accent)] hover:text-[var(--accent-fg)]',
  },
  {
    rating: 4,
    label: 'Easy',
    colorClass: 'text-[var(--success)]',
    bgClass: 'bg-[var(--success-subtle)]',
    borderClass: 'border-[var(--success)]',
    hoverClass: 'hover:bg-[var(--success)] hover:text-[var(--success-fg)]',
  },
]

function formatIntervalDays(days: number): string {
  if (days <= 0) return 'Today'
  if (days < 30) return `${days} d`
  if (days < 365) return `${Math.round(days / 30)} mo`
  const years = Math.round((days / 365) * 10) / 10
  return `${years} yr`
}

interface ConfidenceRatingProps {
  onRate: (rating: Difficulty) => void
  className?: string
  /** Current FSRS state of the card being rated — used to preview the real
   *  interval each rating would schedule. Omitted → no interval line. */
  fsrs?: FSRSState
}

/**
 * Full 4-button confidence rating row (Missed / Hard / Good / Easy).
 * Used inside an expandable "More ratings" section in the session page —
 * the primary session flow uses Forgot (1) / Remembered (4) pill buttons.
 *
 * The interval under each label is a real preview: fsrsSchedule (pure) is run
 * once per rating against the card's current FSRS state with the user's own
 * weights/retention settings — the same call reviewCard makes when the rating
 * is actually committed.
 */
export function ConfidenceRating({ onRate, className, fsrs }: ConfidenceRatingProps) {
  const { fsrsWeights, fsrsTargetRetention, fsrsMaxInterval } = useSettingsStore(
    useShallow((s) => ({
      fsrsWeights: s.fsrsWeights,
      fsrsTargetRetention: s.fsrsTargetRetention,
      fsrsMaxInterval: s.fsrsMaxInterval,
    }))
  )

  const intervals = useMemo<Record<Difficulty, string> | null>(() => {
    if (!fsrs) return null
    const params = {
      ...DEFAULT_FSRS_PARAMS,
      weights: fsrsWeights,
      targetRetention: fsrsTargetRetention,
      maximumInterval: fsrsMaxInterval,
      requestRetention: fsrsTargetRetention,
    }
    const out = {} as Record<Difficulty, string>
    for (const grade of [1, 2, 3, 4] as const) {
      const next = fsrsSchedule(fsrs, grade, params)
      // eslint-disable-next-line react-hooks/purity -- the interval preview is wall-clock-relative by design (fsrsSchedule itself anchors on "now"); the memo recomputes per card, which is exactly the freshness needed
      const days = Math.round((new Date(next.dueDate).getTime() - Date.now()) / 86400000)
      out[grade] = formatIntervalDays(days)
    }
    return out
  }, [fsrs, fsrsWeights, fsrsTargetRetention, fsrsMaxInterval])

  return (
    <div className={cn('flex items-center justify-center gap-2 flex-wrap', className)}>
      {RATINGS.map(({ rating, label, colorClass, bgClass, borderClass, hoverClass }) => (
        <button
          key={rating}
          onClick={() => onRate(rating)}
          className={cn(
            'flex flex-col items-center gap-1 px-4 py-2.5 rounded-[var(--radius)]',
            'border transition-colors duration-100 select-none min-w-[72px]',
            bgClass,
            borderClass,
            colorClass,
            hoverClass,
          )}
        >
          <span className="text-sm font-semibold">{label}</span>
          {intervals && <span className="text-[10px] opacity-70">{intervals[rating]}</span>}
        </button>
      ))}
    </div>
  )
}
