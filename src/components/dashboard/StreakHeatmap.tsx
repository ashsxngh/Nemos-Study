'use client'

import { cn, formatDate } from '@/lib/utils'
import { useHistoryStore } from '@/store/useHistoryStore'
import { toLocalDateStr } from '@/lib/formatDate'

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', '']

function intensityClass(count: number): string {
  if (count === 0) return 'bg-[var(--bg-active)]'
  if (count < 5) return 'bg-[var(--accent)] opacity-25'
  if (count < 15) return 'bg-[var(--accent)] opacity-50'
  if (count < 30) return 'bg-[var(--accent)] opacity-75'
  return 'bg-[var(--accent)]'
}

interface DayCell {
  date: Date
  count: number
}

function buildYearData(reviewLogs: { reviewedAt: string }[], year: number): DayCell[][] {
  const countMap: Record<string, number> = {}
  for (const log of reviewLogs) {
    const day = toLocalDateStr(new Date(log.reviewedAt))
    countMap[day] = (countMap[day] ?? 0) + 1
  }

  // Build array of all days in the year, grouped by week (columns)
  // Week starts on Sunday to match calendar convention
  const jan1 = new Date(year, 0, 1)
  const dec31 = new Date(year, 11, 31)

  // Pad start to Sunday
  const startOffset = jan1.getDay() // 0=Sun
  const startDate = new Date(jan1)
  startDate.setDate(startDate.getDate() - startOffset)

  // Pad end to Saturday
  const endOffset = 6 - dec31.getDay()
  const endDate = new Date(dec31)
  endDate.setDate(endDate.getDate() + endOffset)

  const weeks: DayCell[][] = []
  const cur = new Date(startDate)

  while (cur <= endDate) {
    const week: DayCell[] = []
    for (let d = 0; d < 7; d++) {
      const key = toLocalDateStr(cur)
      const inYear = cur.getFullYear() === year
      week.push({ date: new Date(cur), count: inYear ? (countMap[key] ?? 0) : -1 })
      cur.setDate(cur.getDate() + 1)
    }
    weeks.push(week)
  }

  return weeks
}

function getMonthPositions(weeks: DayCell[][]): { label: string; col: number }[] {
  const positions: { label: string; col: number }[] = []
  let lastMonth = -1
  weeks.forEach((week, wi) => {
    // Find the first day in this week that belongs to the year
    const firstValid = week.find((d) => d.count >= 0)
    if (firstValid) {
      const m = firstValid.date.getMonth()
      if (m !== lastMonth) {
        positions.push({ label: MONTH_LABELS[m], col: wi })
        lastMonth = m
      }
    }
  })
  return positions
}

export function StreakHeatmap() {
  const reviewLogs = useHistoryStore((s) => s.reviewLogs)
  const year = new Date().getFullYear()
  const weeks = buildYearData(reviewLogs, year)
  const monthPositions = getMonthPositions(weeks)

  // Summary stats
  const activeDays = new Set(
    reviewLogs
      .filter((l) => new Date(l.reviewedAt).getFullYear() === year)
      .map((l) => toLocalDateStr(new Date(l.reviewedAt)))
  ).size
  // Repeat reviews only — new-card graduations aren't reviews. The day cells
  // above deliberately still count all activity (learning new cards keeps a
  // streak day alive), so they're labeled "cards", not "reviews".
  const totalReviews = reviewLogs.filter(
    (l) => !l.wasNew && new Date(l.reviewedAt).getFullYear() === year
  ).length

  return (
    <div className="mb-6">
      {/* Month labels */}
      <div className="overflow-x-auto">
        <div style={{ minWidth: 'max-content' }}>
          {/* Month header row */}
          <div className="flex mb-1 ml-8">
            {monthPositions.map(({ label, col }, i) => {
              const nextCol = monthPositions[i + 1]?.col ?? weeks.length
              const width = (nextCol - col) * 12 // 10px cell + 2px gap
              return (
                <div
                  key={label}
                  className="text-[10px] text-[var(--text-muted)] truncate"
                  style={{ width: `${width}px`, minWidth: 0 }}
                >
                  {label}
                </div>
              )
            })}
          </div>

          {/* Heatmap grid */}
          <div className="flex gap-0">
            {/* Day labels */}
            <div className="flex flex-col mr-1">
              {DAY_LABELS.map((d, i) => (
                <div
                  key={i}
                  className="text-[10px] text-[var(--text-muted)] flex items-center justify-end pr-1"
                  style={{ height: '12px', marginBottom: '2px' }}
                >
                  {d}
                </div>
              ))}
            </div>

            {/* Columns (weeks) */}
            <div className="flex gap-[2px]">
              {weeks.map((week, wi) => (
                <div key={wi} className="flex flex-col gap-[2px]">
                  {week.map(({ date, count }, di) => (
                    <div
                      key={di}
                      title={count >= 0 ? `${formatDate(date)}: ${count} cards` : ''}
                      className={cn(
                        'rounded-[2px] transition-opacity',
                        count < 0
                          ? 'opacity-0'
                          : cn('hover:opacity-80', intensityClass(count))
                      )}
                      style={{ width: '10px', height: '10px' }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Summary + legend */}
      <div className="flex items-center justify-between mt-3">
        <p className="text-xs text-[var(--text-muted)]">
          {totalReviews > 0
            ? `${totalReviews} reviews over ${activeDays} active days`
            : 'No reviews yet this year'}
        </p>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-[var(--text-muted)]">Less</span>
          {[0, 3, 10, 20, 40].map((v) => (
            <div
              key={v}
              className={cn('rounded-[2px]', intensityClass(v))}
              style={{ width: '10px', height: '10px' }}
            />
          ))}
          <span className="text-[10px] text-[var(--text-muted)]">More</span>
        </div>
      </div>
    </div>
  )
}
