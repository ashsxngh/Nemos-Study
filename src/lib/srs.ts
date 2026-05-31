import type { SRSData, Difficulty } from './types'

const DEFAULT_EASE = 2.5
const MIN_EASE = 1.3
const HARD_PENALTY = 0.15

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
  }
}

export function fsrsSchedule(
  state: FSRSState,
  grade: 1 | 2 | 3 | 4,
  params: FSRSParams = DEFAULT_FSRS_PARAMS,
): FSRSState {
  const w = params.weights
  const now = new Date()

  // Days since last review (for retrievability calculation)
  const t = state.lastReviewedAt
    ? (now.getTime() - new Date(state.lastReviewedAt).getTime()) / (1000 * 60 * 60 * 24)
    : 0

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
    // Update difficulty: D(D, G) = D - w[6] * (G - 3), clamped to [1,10]
    newDifficulty = state.difficulty - w[6] * (grade - 3)
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
      newRepetitions = 0
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
  const interval = Math.min(
    params.maximumInterval,
    Math.max(1, Math.ceil(9 * newStability * (1 / r - 1))),
  )

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

export interface SRSSettings {
  easyBonus: number         // multiplier for Easy (default 1.3)
  hardInterval: number      // multiplier for Hard interval (default 1.2)
  lapseInterval: number     // % of interval after lapse (default 10, means 10%)
  startingEase: number      // default ease for new cards (default 2.5)
  graduatingInterval: number // days for first Good review (default 4)
}

export function createInitialSRSData(cardId: string, userId: string, settings?: SRSSettings): SRSData {
  return {
    cardId,
    userId,
    interval: 0,
    easeFactor: settings?.startingEase ?? DEFAULT_EASE,
    repetitions: 0,
    dueDate: new Date().toISOString(),
    lastReviewedAt: null,
    lapses: 0,
    masteryPercent: 0,
  }
}

export function scheduleCard(srs: SRSData, rating: Difficulty, settings?: SRSSettings): SRSData {
  const now = new Date()
  let { interval, easeFactor, repetitions, lapses } = srs

  const hardMultiplier = settings?.hardInterval ?? 1.2
  const graduatingInterval = settings?.graduatingInterval ?? 4
  const easyBonusAddition = settings?.easyBonus ?? 0.15
  const lapseIntervalPct = settings?.lapseInterval ?? 10

  // rating: 1=Again, 2=Hard, 3=Good, 4=Easy
  if (rating === 1) {
    // Again — reset
    lapses++
    interval = Math.max(1, Math.round(srs.interval * lapseIntervalPct / 100))
    repetitions = 0
    easeFactor = Math.max(MIN_EASE, easeFactor - 0.2)
  } else if (rating === 2) {
    // Hard — small advance
    interval = Math.max(1, Math.round(interval * hardMultiplier))
    easeFactor = Math.max(MIN_EASE, easeFactor - HARD_PENALTY)
    repetitions++
  } else if (rating === 3) {
    // Good — standard SM2
    if (repetitions === 0) interval = 1
    else if (repetitions === 1) interval = graduatingInterval
    else interval = Math.round(interval * easeFactor)
    repetitions++
  } else {
    // Easy — boost
    if (repetitions === 0) interval = 4
    else if (repetitions === 1) interval = 10
    else interval = Math.round(interval * easeFactor * 1.3)
    easeFactor = easeFactor + easyBonusAddition
    repetitions++
  }

  const dueDate = new Date(now)
  dueDate.setDate(dueDate.getDate() + interval)

  const masteryPercent = computeMastery({ ...srs, interval, easeFactor, repetitions, lapses })

  return {
    ...srs,
    interval,
    easeFactor,
    repetitions,
    lapses,
    dueDate: dueDate.toISOString(),
    lastReviewedAt: now.toISOString(),
    masteryPercent,
  }
}

function computeMastery(srs: Omit<SRSData, 'masteryPercent'>): number {
  const { repetitions, lapses, interval, easeFactor } = srs
  if (repetitions === 0) return 0

  const repScore = Math.min(repetitions / 10, 1) * 40
  const lapseScore = Math.max(0, 20 - lapses * 5)
  const intervalScore = Math.min(interval / 30, 1) * 25
  const easeScore = Math.min((easeFactor - MIN_EASE) / (3.0 - MIN_EASE), 1) * 15

  return Math.round(repScore + lapseScore + intervalScore + easeScore)
}

export function isDue(srs: SRSData): boolean {
  return new Date(srs.dueDate) <= new Date()
}

export function daysUntilDue(srs: SRSData): number {
  const diff = new Date(srs.dueDate).getTime() - Date.now()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

export function predictRetention(srs: SRSData): number {
  if (!srs.lastReviewedAt) return 0
  const daysSinceReview =
    (Date.now() - new Date(srs.lastReviewedAt).getTime()) / (1000 * 60 * 60 * 24)
  const stability = srs.interval * srs.easeFactor
  return Math.round(Math.exp((-daysSinceReview / stability) * Math.LN2) * 100)
}

export function sortByPriority(cards: SRSData[]): SRSData[] {
  return [...cards].sort((a, b) => {
    // Overdue first, then by lapses, then by ease
    const aOverdue = Math.max(0, -daysUntilDue(a))
    const bOverdue = Math.max(0, -daysUntilDue(b))
    if (aOverdue !== bOverdue) return bOverdue - aOverdue
    if (a.lapses !== b.lapses) return b.lapses - a.lapses
    return a.easeFactor - b.easeFactor
  })
}
