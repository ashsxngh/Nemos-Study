'use client'

/**
 * Active-time measurement for study sessions.
 *
 * "Study time" means time the learner was actually looking at a card — not
 * wall-clock time with the app open. Two rules define it:
 *
 *  1. **Foreground only.** The clock runs only while the tab is visible AND the
 *     window has focus. Backgrounding the tab, minimising the window, or
 *     clicking away to another app stops it immediately and it resumes on
 *     return. Without this, a card left open overnight counted every one of
 *     those hours as study time (the live data held a single 19.3-hour
 *     `responseMs`, and the mean sat at ~100s per card).
 *  2. **Capped per card.** A single card contributes at most
 *     `CARD_TIME_CAP_MS`. Even in the foreground, a card someone walks away
 *     from mid-answer is not 40 minutes of studying.
 *
 * Both rules apply to per-card `responseMs` and to every total built from it.
 */

/** Maximum time one card may contribute to any timing statistic. */
export const CARD_TIME_CAP_MS = 60_000

/** True when the page is both visible and focused, i.e. the clock should run. */
export function isPageActive(): boolean {
  if (typeof document === 'undefined') return false
  if (document.visibilityState !== 'visible') return false
  // hasFocus covers "visible but the user clicked another window". Guard the
  // call: it is absent in some non-browser/SSR-ish environments.
  if (typeof document.hasFocus === 'function' && !document.hasFocus()) return false
  return true
}

/** Clamp a raw duration to the per-card cap. Also floors negatives at 0. */
export function capCardMs(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) return 0
  return Math.min(ms, CARD_TIME_CAP_MS)
}

/**
 * A stopwatch that only advances while the page is active.
 *
 * Callers do not poll it — `subscribeToActivity` drives `pause()`/`resume()`
 * from the real visibility/focus events, and `elapsed()` reports the total
 * accumulated so far.
 */
export class ActiveTimer {
  private accumulated = 0
  private runningSince: number | null = null

  constructor() {
    this.reset()
  }

  /** Stop accumulating (page went to the background or lost focus). */
  pause(): void {
    if (this.runningSince !== null) {
      this.accumulated += Date.now() - this.runningSince
      this.runningSince = null
    }
  }

  /** Start accumulating again (page came back). No-op if already running. */
  resume(): void {
    if (this.runningSince === null) this.runningSince = Date.now()
  }

  /** Active milliseconds so far. Safe to call while running or paused. */
  elapsed(): number {
    return this.accumulated + (this.runningSince !== null ? Date.now() - this.runningSince : 0)
  }

  /** Active milliseconds so far, clamped to the per-card cap. */
  cappedElapsed(): number {
    return capCardMs(this.elapsed())
  }

  /** Zero the clock and start it iff the page is currently active. */
  reset(): void {
    this.accumulated = 0
    this.runningSince = isPageActive() ? Date.now() : null
  }
}

/**
 * Wire the browser's activity events to a set of timers. Returns an unsubscribe
 * function. `visibilitychange` covers tab switches and minimising;
 * `focus`/`blur` cover another window taking focus while this tab stays
 * "visible". Both are needed — neither alone catches every case.
 */
export function subscribeToActivity(timers: ActiveTimer[]): () => void {
  if (typeof window === 'undefined') return () => {}

  const sync = () => {
    const active = isPageActive()
    for (const t of timers) {
      if (active) t.resume()
      else t.pause()
    }
  }

  document.addEventListener('visibilitychange', sync)
  window.addEventListener('focus', sync)
  window.addEventListener('blur', sync)
  // pagehide fires on mobile when the tab is frozen without a visibilitychange.
  window.addEventListener('pagehide', sync)
  sync()

  return () => {
    document.removeEventListener('visibilitychange', sync)
    window.removeEventListener('focus', sync)
    window.removeEventListener('blur', sync)
    window.removeEventListener('pagehide', sync)
  }
}

/**
 * Total active study time (ms) represented by a set of review logs.
 *
 * Study time is derived from per-card active time rather than from
 * `endedAt - startedAt` session wall-clock, which counted backgrounded tabs,
 * interruptions and the time spent sitting on the session-complete screen.
 * Each log is capped, so one abandoned card can no longer dominate a total.
 */
export function activeStudyMs(logs: { responseMs?: number }[]): number {
  let total = 0
  for (const l of logs) total += capCardMs(l.responseMs ?? 0)
  return total
}
