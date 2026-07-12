import type { Difficulty } from './types'

// ── FSRS-5 ────────────────────────────────────────────────────────────────────

export interface FSRSState {
  cardId: string
  userId: string
  stability: number       // S — days until R drops to 90%
  difficulty: number      // D — 1-10 scale
  retrievability: number  // R at last review
  dueDate: string
  lastReviewedAt: string | null
  repetitions: number
  lapses: number
  state: 'new' | 'learning' | 'review' | 'relearning'
  // Client-stamped on every local write (init/review/reset/undo — see
  // useLibraryStore's fsrs actions); overwritten server-side by the fsrs_data
  // updated_at DB trigger on every upsert. The sync pull merge compares this
  // against the server row's updated_at so a stale server copy can't revert a
  // newer local review (push-failure window). Optional because rows persisted
  // before this field existed lack it — those fall back to server-wins.
  updatedAt?: string
}

export interface FSRSParams {
  weights: number[]        // w0-w16, 17 values
  targetRetention: number  // default 0.9
  maximumInterval: number  // default 36500 (100 years)
  requestRetention: number // same as targetRetention for simplicity
}

export const DEFAULT_FSRS_PARAMS: FSRSParams = {
  weights: [0.4072, 1.1829, 3.1262, 15.4722, 7.2102, 0.5316, 1.0651, 0.0589, 1.3547, 0.1049, 1.0, 1.9898, 0.11, 0.29, 2.2700, 0.1790, 2.9898],
  targetRetention: 0.9,
  maximumInterval: 36500,
  requestRetention: 0.9,
}

// ── Interval fuzz ─────────────────────────────────────────────────────────────
// Mirrors Anki's fuzz ranges: intervals < 2.5 days are not fuzzed; longer
// intervals get ±1 day plus a range-proportional percentage. The card ID is
// used as a deterministic seed so every card in the same batch spreads out
// without the fuzz changing between re-renders.

function fuzzDelta(interval: number): number {
  if (interval < 2.5) return 0
  const ranges = [
    { start: 2.5, end: 7.0, factor: 0.15 },
    { start: 7.0, end: 20.0, factor: 0.10 },
    { start: 20.0, end: Infinity, factor: 0.05 },
  ]
  let delta = 1.0
  for (const { start, end, factor } of ranges) {
    if (interval <= start) break
    delta += factor * (Math.min(interval, end) - start)
  }
  return delta
}

export function withFuzz(interval: number, cardId: string): number {
  if (interval < 2.5) return Math.round(interval)
  const delta = fuzzDelta(interval)
  const lower = Math.max(1, Math.round(interval - delta))
  const upper = Math.round(interval + delta)
  let seed = 0
  for (let i = 0; i < cardId.length; i++) {
    seed = (seed + cardId.charCodeAt(i)) % 997
  }
  const range = Math.max(1, upper - lower + 1)
  return lower + (seed % range)
}

export function fsrsInitCard(cardId: string, userId: string): FSRSState {
  return {
    cardId,
    userId,
    stability: 0,
    difficulty: 0,
    retrievability: 0,
    dueDate: new Date().toISOString(),
    lastReviewedAt: null,
    repetitions: 0,
    lapses: 0,
    state: 'new',
    updatedAt: new Date().toISOString(),
  }
}

export function fsrsSchedule(
  state: FSRSState,
  grade: 1 | 2 | 3 | 4,
  params: FSRSParams = DEFAULT_FSRS_PARAMS,
  reviewedAt?: Date,
): FSRSState {
  const w = params.weights
  const now = reviewedAt ?? new Date()

  // Days since last review (for retrievability calculation)
  const t = state.lastReviewedAt
    ? (now.getTime() - new Date(state.lastReviewedAt).getTime()) / (1000 * 60 * 60 * 24)
    : 0

  // Days late relative to scheduled interval (for Good-review bonus)
  const scheduledInterval =
    state.lastReviewedAt && state.dueDate
      ? (new Date(state.dueDate).getTime() - new Date(state.lastReviewedAt).getTime()) / 86400000
      : 0
  const daysLate = Math.max(0, t - scheduledInterval)

  // Current retrievability
  const R =
    state.stability > 0 && state.lastReviewedAt
      ? Math.pow(1 + t / (9 * state.stability), -1)
      : 1

  let newStability: number
  let newDifficulty: number
  let newLapses = state.lapses
  let newRepetitions = state.repetitions
  let newState: FSRSState['state']

  if (state.state === 'new') {
    // Initial stability: w[0..3] indexed by grade 1..4
    const s0Map: Record<number, number> = { 1: w[0], 2: w[1], 3: w[2], 4: w[3] }
    newStability = Math.max(0.1, s0Map[grade])

    // Initial difficulty: D0(G) = w[4] - exp(w[5] * (G - 1)) + 1
    newDifficulty = w[4] - Math.exp(w[5] * (grade - 1)) + 1
    newDifficulty = Math.min(10, Math.max(1, newDifficulty))

    newRepetitions = 1
    newState = grade === 1 ? 'relearning' : 'learning'
  } else {
    // Update difficulty with FSRS-5 mean reversion:
    // D_temp = D - w[6]*(G-3);  D' = w[5]*D0(G=3) + (1 - w[5])*D_temp
    const d0Good = w[4] - Math.exp(w[5] * (3 - 1)) + 1
    const dTemp = state.difficulty - w[6] * (grade - 3)
    newDifficulty = w[5] * d0Good + (1 - w[5]) * dTemp
    newDifficulty = Math.min(10, Math.max(1, newDifficulty))

    if (grade === 1) {
      // Forgetting — stability after lapse
      // S'_f(D,S,R) = w[11] * D^(-w[12]) * ((S+1)^w[13] - 1) * exp(w[14]*(1-R))
      newStability =
        w[11] *
        Math.pow(state.difficulty, -w[12]) *
        (Math.pow(state.stability + 1, w[13]) - 1) *
        Math.exp(w[14] * (1 - R))
      newStability = Math.max(0.1, newStability)
      newLapses++
      newState = 'relearning'
    } else {
      // Successful review — stability after recall
      // S'_r = S * (exp(w[8]) * (11-D) * S^(-w[9]) * (exp(w[10]*(1-R)) - 1)
      //              * (w[15] if G=2 else 1) * (w[16] if G=4 else 1) + 1)
      const hardPenalty = grade === 2 ? w[15] : 1
      const easyBonus = grade === 4 ? w[16] : 1
      newStability =
        state.stability *
        (Math.exp(w[8]) *
          (11 - state.difficulty) *
          Math.pow(state.stability, -w[9]) *
          (Math.exp(w[10] * (1 - R)) - 1) *
          hardPenalty *
          easyBonus +
          1)
      newStability = Math.max(0.1, newStability)
      newRepetitions++
      newState = 'review'
    }
  }

  // Interval in days: ceil(9 * S * (1/r - 1)) where r = targetRetention
  const r = params.targetRetention
  let interval = Math.min(
    params.maximumInterval,
    Math.max(1, Math.ceil(9 * newStability * (1 / r - 1))),
  )
  // Days-late bonus for Good reviews on established cards
  if (grade === 3 && state.state !== 'new') {
    interval = Math.min(params.maximumInterval, interval + Math.floor(daysLate / 2))
  }
  interval = withFuzz(interval, state.cardId)

  const dueDate = new Date(now)
  dueDate.setDate(dueDate.getDate() + interval)

  return {
    ...state,
    stability: newStability,
    difficulty: newDifficulty,
    retrievability: R,
    dueDate: dueDate.toISOString(),
    lastReviewedAt: now.toISOString(),
    repetitions: newRepetitions,
    lapses: newLapses,
    state: newState,
  }
}

export function fsrsRetrievability(state: FSRSState): number {
  if (!state.lastReviewedAt || state.stability <= 0) return 0
  const t =
    (Date.now() - new Date(state.lastReviewedAt).getTime()) / (1000 * 60 * 60 * 24)
  return Math.pow(1 + t / (9 * state.stability), -1)
}

// ── FSRS weight optimization ──────────────────────────────────────────────────

export interface OptimizeInput {
  cardId: string
  rating: Difficulty
  reviewedAt: string
}

export interface OptimizeResult {
  weights: number[]
  reviewCount: number   // number of predictions the fit was based on
  logLoss: number
}

export const MIN_REVIEWS_FOR_OPTIMIZATION = 50

/**
 * Coarse-grid optimizer: replays the review history and tunes two knobs —
 * a scale on the initial-stability weights (w0–w3) and a shift on the
 * stability-growth weight (w8) — to minimize log-loss between predicted
 * retrievability and actual recall outcomes (rating 1 = forgot).
 */
export function optimizeFsrsWeights(
  logs: OptimizeInput[],
  base: FSRSParams = DEFAULT_FSRS_PARAMS,
): OptimizeResult | null {
  // Group logs by card, chronologically
  const byCard = new Map<string, OptimizeInput[]>()
  for (const log of logs) {
    const list = byCard.get(log.cardId)
    if (list) list.push(log)
    else byCard.set(log.cardId, [log])
  }
  for (const list of byCard.values()) {
    list.sort((a, b) => new Date(a.reviewedAt).getTime() - new Date(b.reviewedAt).getTime())
  }

  function evaluate(weights: number[]): { loss: number; n: number } {
    const params: FSRSParams = { ...base, weights }
    let loss = 0
    let n = 0
    for (const [cardId, list] of byCard) {
      let state = fsrsInitCard(cardId, 'optimizer')
      for (const log of list) {
        const reviewedAt = new Date(log.reviewedAt)
        // Predict recall for every review after the first
        if (state.lastReviewedAt && state.stability > 0) {
          const t = Math.max(
            0,
            (reviewedAt.getTime() - new Date(state.lastReviewedAt).getTime()) / 86400000,
          )
          const r = Math.min(0.99, Math.max(0.01, Math.pow(1 + t / (9 * state.stability), -1)))
          const recalled = log.rating >= 2
          loss += recalled ? -Math.log(r) : -Math.log(1 - r)
          n++
        }
        state = fsrsSchedule(state, log.rating, params, reviewedAt)
      }
    }
    return { loss: n > 0 ? loss / n : Infinity, n }
  }

  // Check we have enough inter-review predictions to fit against
  const baseline = evaluate(base.weights)
  if (baseline.n < MIN_REVIEWS_FOR_OPTIMIZATION) return null

  const stabilityScales = [0.5, 0.65, 0.8, 1.0, 1.25, 1.5, 1.8, 2.2]
  const growthShifts = [-0.4, -0.2, 0, 0.2, 0.4]

  let best = { weights: base.weights, loss: baseline.loss }
  for (const scale of stabilityScales) {
    for (const shift of growthShifts) {
      const weights = [...base.weights]
      for (let i = 0; i <= 3; i++) weights[i] = Math.max(0.05, weights[i] * scale)
      weights[8] = weights[8] + shift
      const { loss } = evaluate(weights)
      if (loss < best.loss) best = { weights, loss }
    }
  }

  return {
    weights: best.weights.map((w) => Math.round(w * 10000) / 10000),
    reviewCount: baseline.n,
    logLoss: Math.round(best.loss * 10000) / 10000,
  }
}

