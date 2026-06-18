'use client'

import { cn } from '@/lib/utils'
import type { Difficulty } from '@/lib/types'

interface RatingOption {
  rating: Difficulty
  label: string
  interval: string
  colorClass: string
  bgClass: string
  borderClass: string
  hoverClass: string
}

const RATINGS: RatingOption[] = [
  {
    rating: 1,
    label: 'Again',
    interval: '10 min',
    colorClass: 'text-[var(--danger)]',
    bgClass: 'bg-[var(--danger-subtle)]',
    borderClass: 'border-[var(--danger)]',
    hoverClass: 'hover:bg-[var(--danger)] hover:text-white',
  },
  {
    rating: 2,
    label: 'Hard',
    interval: '3 days',
    colorClass: 'text-orange-400',
    bgClass: 'bg-orange-950/30',
    borderClass: 'border-orange-400',
    hoverClass: 'hover:bg-orange-400 hover:text-white',
  },
  {
    rating: 3,
    label: 'Good',
    interval: '7 days',
    colorClass: 'text-[var(--accent)]',
    bgClass: 'bg-[var(--accent-subtle)]',
    borderClass: 'border-[var(--accent)]',
    hoverClass: 'hover:bg-[var(--accent)] hover:text-white',
  },
  {
    rating: 4,
    label: 'Easy',
    interval: '21 days',
    colorClass: 'text-[var(--success)]',
    bgClass: 'bg-[var(--success-subtle)]',
    borderClass: 'border-[var(--success)]',
    hoverClass: 'hover:bg-[var(--success)] hover:text-white',
  },
]

interface ConfidenceRatingProps {
  onRate: (rating: Difficulty) => void
  className?: string
}

/**
 * Full 4-button confidence rating row (Again / Hard / Good / Easy).
 * Used inside an expandable "More ratings" section in the session page —
 * the primary session flow uses Forgot (1) / Remembered (4) pill buttons.
 */
export function ConfidenceRating({ onRate, className }: ConfidenceRatingProps) {
  return (
    <div className={cn('flex items-center justify-center gap-2 flex-wrap', className)}>
      {RATINGS.map(({ rating, label, interval, colorClass, bgClass, borderClass, hoverClass }) => (
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
          <span className="text-[10px] opacity-70">{interval}</span>
        </button>
      ))}
    </div>
  )
}
