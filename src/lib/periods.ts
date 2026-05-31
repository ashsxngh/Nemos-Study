export type Period = 'today' | 'yesterday' | '7d' | '30d' | '6m' | '1y' | 'all'

export const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: 'today',     label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: '7d',        label: 'Last 7 days' },
  { value: '30d',       label: 'Last 30 days' },
  { value: '6m',        label: 'Last 6 months' },
  { value: '1y',        label: 'Last year' },
  { value: 'all',       label: 'All time' },
]

export interface PeriodRange {
  start: Date
  end: Date
  label: string
  /** The equivalent previous window for comparison */
  prevStart: Date
  prevEnd: Date
}

export function getPeriodRange(period: Period): PeriodRange {
  const now = new Date()
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)

  switch (period) {
    case 'today': {
      const prevStart = new Date(startOfToday)
      prevStart.setDate(prevStart.getDate() - 1)
      return { start: startOfToday, end: now, label: 'Today', prevStart, prevEnd: startOfToday }
    }
    case 'yesterday': {
      const s = new Date(startOfToday); s.setDate(s.getDate() - 1)
      const prevS = new Date(s);        prevS.setDate(prevS.getDate() - 1)
      return { start: s, end: startOfToday, label: 'Yesterday', prevStart: prevS, prevEnd: s }
    }
    case '7d': {
      const s = new Date(startOfToday); s.setDate(s.getDate() - 7)
      const prevS = new Date(s);        prevS.setDate(prevS.getDate() - 7)
      return { start: s, end: now, label: 'Last 7 days', prevStart: prevS, prevEnd: s }
    }
    case '30d': {
      const s = new Date(startOfToday); s.setDate(s.getDate() - 30)
      const prevS = new Date(s);        prevS.setDate(prevS.getDate() - 30)
      return { start: s, end: now, label: 'Last 30 days', prevStart: prevS, prevEnd: s }
    }
    case '6m': {
      const s = new Date(startOfToday); s.setMonth(s.getMonth() - 6)
      const prevS = new Date(s);        prevS.setMonth(prevS.getMonth() - 6)
      return { start: s, end: now, label: 'Last 6 months', prevStart: prevS, prevEnd: s }
    }
    case '1y': {
      const s = new Date(startOfToday); s.setFullYear(s.getFullYear() - 1)
      const prevS = new Date(s);        prevS.setFullYear(prevS.getFullYear() - 1)
      return { start: s, end: now, label: 'Last year', prevStart: prevS, prevEnd: s }
    }
    case 'all':
      return { start: new Date(0), end: now, label: 'All time', prevStart: new Date(0), prevEnd: new Date(0) }
  }
}

export function logsInRange<T extends { reviewedAt: string }>(
  logs: T[],
  start: Date,
  end: Date
): T[] {
  return logs.filter((l) => {
    const t = new Date(l.reviewedAt)
    return t >= start && t <= end
  })
}
