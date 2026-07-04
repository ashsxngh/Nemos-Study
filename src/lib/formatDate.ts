// Local-calendar-day key for bucketing/comparing "which day did this happen"
// (streaks, heatmap, today's stats, daily new-card cap). Date.toISOString()
// is always UTC, so slicing it silently anchors "day" boundaries to UTC
// midnight instead of the user's midnight — this is the local-time equivalent.
export function toLocalDateStr(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
