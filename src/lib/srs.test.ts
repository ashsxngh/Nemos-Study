/**
 * Proves Nemos actually schedules with the official FSRS-6 implementation —
 * not merely that a due date comes out the other end.
 *
 * The core technique is differential: for each scenario the same card is run
 * (a) through the Nemos adapter and (b) directly through a bare `fsrs()`
 * instance from `ts-fsrs`, and the FSRS-owned numbers must match exactly.
 * If the adapter ever grew maths of its own, or silently fell back to a
 * home-grown scheduler, these comparisons would diverge.
 */

import { describe, expect, it } from 'vitest'
import {
  createEmptyCard,
  default_w,
  forgetting_curve,
  fsrs,
  FSRSVersion,
  generatorParameters,
  Rating,
  State,
} from 'ts-fsrs'
import type { Card as FsrsCard } from 'ts-fsrs'
import {
  DEFAULT_FSRS_PARAMS,
  FSRS6_SCHEDULER_VERSION,
  FSRS_WEIGHT_COUNT,
  fsrsForgettingCurve,
  fsrsInitCard,
  fsrsParameters,
  fsrsRetrievability,
  fsrsReview,
  isValidFsrsWeights,
  NEMOS_FORGOT_GRADE,
  NEMOS_REMEMBERED_GRADE,
  toFsrsCard,
  toFsrsGrade,
  type FSRSState,
} from './srs'

const ID = { cardId: '11111111-1111-4111-8111-111111111111', userId: 'user-1' }
const T0 = new Date('2026-07-01T09:00:00.000Z')

/** The parameter set the adapter builds from Nemos' defaults. */
const params = fsrsParameters()

/**
 * A bare, independently-constructed reference scheduler. Deliberately built
 * from the library's own `generatorParameters` rather than from the adapter's
 * output, so it is not downstream of anything under test.
 */
const reference = fsrs(
  generatorParameters({
    w: default_w,
    request_retention: 0.9,
    maximum_interval: 36500,
    enable_fuzz: true,
    enable_short_term: true,
    learning_steps: ['1m', '10m'],
    relearning_steps: ['10m'],
  }),
)

function newState(now: Date = T0): FSRSState {
  return fsrsInitCard(ID.cardId, ID.userId, now)
}

// ── Sanity: we really are on FSRS-6 ───────────────────────────────────────────

describe('library identity', () => {
  it('is the official ts-fsrs package running FSRS-6', () => {
    expect(FSRSVersion).toContain('FSRS-6')
    // FSRS-6 has 21 parameters (FSRS-5 had 17); w[20] is decay.
    expect(FSRS_WEIGHT_COUNT).toBe(21)
    expect(DEFAULT_FSRS_PARAMS.weights).toHaveLength(21)
    expect(DEFAULT_FSRS_PARAMS.weights).toEqual([...default_w])
    // The FSRS-6 default decay, not FSRS-5's 0.5.
    expect(DEFAULT_FSRS_PARAMS.weights[20]).toBeCloseTo(0.1542, 6)
  })

  it('feeds the official defaults, uses official fuzz, and adds no Nemos fuzz layer', () => {
    expect(params.w).toEqual([...default_w])
    expect(params.enable_fuzz).toBe(true)
    expect(params.enable_short_term).toBe(true)
    expect(params.request_retention).toBe(0.9)
    expect([...params.learning_steps]).toEqual(['1m', '10m'])
    expect([...params.relearning_steps]).toEqual(['10m'])
  })

  it('rejects a legacy 17-value FSRS-5 vector instead of padding it to 21', () => {
    const fsrs5 = [
      0.4072, 1.1829, 3.1262, 15.4722, 7.2102, 0.5316, 1.0651, 0.0589, 1.3547,
      0.1049, 1.0, 1.9898, 0.11, 0.29, 2.27, 0.179, 2.9898,
    ]
    expect(isValidFsrsWeights(fsrs5)).toBe(false)
    // ...and the built parameters fall back to the official FSRS-6 defaults
    // rather than carrying any FSRS-5 value through.
    expect(fsrsParameters({ weights: fsrs5 }).w).toEqual([...default_w])
  })
})

// ── Test 1 — new card produces valid FSRS state ───────────────────────────────

describe('Test 1: a new card is a genuine FSRS new card', () => {
  it('matches createEmptyCard field for field', () => {
    const state = newState()
    const empty = createEmptyCard(T0)

    expect(state.state).toBe('new')
    expect(state.stability).toBe(empty.stability)
    expect(state.difficulty).toBe(empty.difficulty)
    expect(state.repetitions).toBe(empty.reps)
    expect(state.lapses).toBe(empty.lapses)
    expect(state.learningSteps).toBe(empty.learning_steps)
    expect(state.scheduledDays).toBe(empty.scheduled_days)
    expect(state.lastReviewedAt).toBeNull()
    expect(new Date(state.dueDate).getTime()).toBe(empty.due.getTime())
    expect(state.schedulerVersion).toBe(FSRS6_SCHEDULER_VERSION)
  })

  it('round-trips back into the library Card shape', () => {
    const card = toFsrsCard(newState())
    expect(card.state).toBe(State.New)
    expect(card.last_review).toBeUndefined()
    // The scheduler accepts it without complaint.
    expect(() => reference.next(card, T0, Rating.Good)).not.toThrow()
  })
})

// ── Test 2 / Test 3 — the two-button mapping ──────────────────────────────────

describe('Tests 2 & 3: two-button UX maps onto FSRS grades', () => {
  it('Remembered is Good (3) — explicitly not Easy (4)', () => {
    expect(NEMOS_REMEMBERED_GRADE).toBe(Rating.Good)
    expect(NEMOS_REMEMBERED_GRADE).not.toBe(Rating.Easy)
    expect(toFsrsGrade(3)).toBe(Rating.Good)
  })

  it('Forgot is Again (1)', () => {
    expect(NEMOS_FORGOT_GRADE).toBe(Rating.Again)
    expect(toFsrsGrade(1)).toBe(Rating.Again)
  })

  it('maps all four grades to the library enum without a bare numeric cast', () => {
    expect(toFsrsGrade(2)).toBe(Rating.Hard)
    expect(toFsrsGrade(4)).toBe(Rating.Easy)
  })

  it('Remembered on a new card enters learning via the official step machine', () => {
    const { state } = fsrsReview(newState(), 3, params, T0)
    const expected = reference.next(createEmptyCard(T0), T0, Rating.Good).card

    expect(state.state).toBe('learning')
    // First learning step, not an immediate graduation to review.
    expect(state.learningSteps).toBe(expected.learning_steps)
    expect(state.learningSteps).toBeGreaterThan(0)
    expect(new Date(state.dueDate).getTime()).toBe(expected.due.getTime())
    // Same-day reachability: the 10m step keeps the card due today, which is
    // what Nemos' local-calendar-day due list needs — no Nemos-side override.
    const minutesOut = (new Date(state.dueDate).getTime() - T0.getTime()) / 60000
    expect(minutesOut).toBeGreaterThan(0)
    expect(minutesOut).toBeLessThan(60)
  })

  it('Forgot on a new card enters learning at the first step (Again)', () => {
    const { state } = fsrsReview(newState(), 1, params, T0)
    const expected = reference.next(createEmptyCard(T0), T0, Rating.Again).card

    expect(state.state).toBe(expected.state === State.Learning ? 'learning' : 'relearning')
    expect(state.stability).toBe(expected.stability)
    expect(state.difficulty).toBe(expected.difficulty)
    expect(new Date(state.dueDate).getTime()).toBe(expected.due.getTime())
  })

  it('Forgot on a graduated review card lapses into relearning', () => {
    // Drive a card to Review first: Good (→ learning) then Good (→ review).
    let state = fsrsReview(newState(), 3, params, T0).state
    state = fsrsReview(state, 3, params, new Date('2026-07-01T09:11:00.000Z')).state
    expect(state.state).toBe('review')

    const lapseAt = new Date('2026-07-06T09:00:00.000Z')
    const before = state.lapses
    const lapsed = fsrsReview(state, 1, params, lapseAt).state

    expect(lapsed.state).toBe('relearning')
    expect(lapsed.lapses).toBe(before + 1)
  })
})

// ── Test 4 — same-day repeated reviews ────────────────────────────────────────

describe('Test 4: repeated same-day reviews use FSRS-6 same-day handling', () => {
  it('graduates through the learning steps within one day, matching the library', () => {
    const t1 = new Date('2026-07-01T09:10:30.000Z')

    const first = fsrsReview(newState(), 3, params, T0).state
    const second = fsrsReview(first, 3, params, t1).state

    let ref: FsrsCard = createEmptyCard(T0)
    ref = reference.next(ref, T0, Rating.Good).card
    ref = reference.next(ref, t1, Rating.Good).card

    expect(second.state).toBe('review')
    expect(second.stability).toBe(ref.stability)
    expect(second.difficulty).toBe(ref.difficulty)
    expect(second.learningSteps).toBe(ref.learning_steps)
    expect(new Date(second.dueDate).getTime()).toBe(ref.due.getTime())
    // Now it has a real multi-day interval — the second review is what earns it.
    expect(second.scheduledDays).toBeGreaterThanOrEqual(1)
  })

  it('handles three same-day reviews (short-term stability path) identically', () => {
    const times = [
      T0,
      new Date('2026-07-01T09:02:00.000Z'),
      new Date('2026-07-01T09:20:00.000Z'),
    ]
    const grades = [1, 3, 3] as const

    let state = newState()
    let ref: FsrsCard = createEmptyCard(T0)
    for (let i = 0; i < times.length; i++) {
      state = fsrsReview(state, grades[i], params, times[i]).state
      ref = reference.next(ref, times[i], toFsrsGrade(grades[i])).card
    }

    expect(state.stability).toBe(ref.stability)
    expect(state.difficulty).toBe(ref.difficulty)
    expect(state.repetitions).toBe(ref.reps)
    expect(state.lapses).toBe(ref.lapses)
    expect(state.learningSteps).toBe(ref.learning_steps)
    expect(new Date(state.dueDate).getTime()).toBe(ref.due.getTime())
  })
})

// ── Tests 5, 6, 8 + section 16 cross-check ────────────────────────────────────

describe('Tests 5, 6 & 8: stability, difficulty and due date come from ts-fsrs', () => {
  // A spread of deterministic scenarios: grades, timings, lapses, overdue.
  const scenarios: { name: string; grades: (1 | 2 | 3 | 4)[]; offsetsMin: number[] }[] = [
    { name: 'good streak on schedule', grades: [3, 3, 3, 3], offsetsMin: [0, 11, 2890, 8000] },
    { name: 'forgot then recover', grades: [3, 3, 1, 3, 3], offsetsMin: [0, 11, 2880, 2895, 9000] },
    { name: 'easy path', grades: [4, 4, 4], offsetsMin: [0, 12, 30000] },
    { name: 'hard path', grades: [2, 2, 3], offsetsMin: [0, 15, 4000] },
    { name: 'heavily overdue', grades: [3, 3, 3], offsetsMin: [0, 11, 200000] },
    { name: 'repeated lapses', grades: [1, 1, 3, 1, 3], offsetsMin: [0, 5, 20, 5000, 5015] },
  ]

  for (const { name, grades, offsetsMin } of scenarios) {
    it(`matches the library exactly — ${name}`, () => {
      let state = newState()
      let ref: FsrsCard = createEmptyCard(T0)

      for (let i = 0; i < grades.length; i++) {
        const at = new Date(T0.getTime() + offsetsMin[i] * 60000)
        const result = fsrsReview(state, grades[i], params, at)
        const refResult = reference.next(ref, at, toFsrsGrade(grades[i]))
        state = result.state
        ref = refResult.card

        // Test 5 — stability is the library's value, bit for bit.
        expect(state.stability).toBe(ref.stability)
        // Test 6 — difficulty likewise.
        expect(state.difficulty).toBe(ref.difficulty)
        // Test 8 — due date is the library's scheduled instant, fuzz included.
        expect(new Date(state.dueDate).getTime()).toBe(ref.due.getTime())
        expect(state.scheduledDays).toBe(ref.scheduled_days)
        expect(result.scheduledDays).toBe(refResult.log.scheduled_days)
        expect(state.repetitions).toBe(ref.reps)
        expect(state.lapses).toBe(ref.lapses)
        expect(state.learningSteps).toBe(ref.learning_steps)
        expect(state.lastReviewedAt).toBe(ref.last_review?.toISOString() ?? null)
      }
    })
  }

  it('keeps difficulty inside FSRS bounds and stability positive throughout', () => {
    let state = newState()
    for (let i = 0; i < 40; i++) {
      const at = new Date(T0.getTime() + i * 36e5)
      state = fsrsReview(state, i % 5 === 0 ? 1 : 3, params, at).state
      expect(state.difficulty).toBeGreaterThanOrEqual(1)
      expect(state.difficulty).toBeLessThanOrEqual(10)
      expect(state.stability).toBeGreaterThan(0)
    }
  })

  it('honours desired retention through the library, not an interval multiplier', () => {
    // Same card, two retention targets: a higher target must schedule sooner.
    let base = fsrsReview(newState(), 3, params, T0).state
    base = fsrsReview(base, 3, params, new Date('2026-07-01T09:11:00.000Z')).state

    const at = new Date('2026-07-10T09:00:00.000Z')
    const lax = fsrsReview(base, 3, fsrsParameters({ targetRetention: 0.8 }), at).state
    const strict = fsrsReview(base, 3, fsrsParameters({ targetRetention: 0.97 }), at).state

    expect(new Date(strict.dueDate).getTime()).toBeLessThan(new Date(lax.dueDate).getTime())
    // Memory state itself is retention-independent — only the interval moves.
    expect(strict.stability).toBe(lax.stability)
    expect(strict.difficulty).toBe(lax.difficulty)
  })

  it('passes the maximum-interval cap through to the library verbatim', () => {
    // Nemos applies no cap of its own — whatever the library does with
    // maximum_interval is what happens, quirks included. (The Easy path can
    // exceed the cap by a day upstream, because easy_interval is forced above
    // good_interval after clamping; asserting equality with the reference is
    // the honest test, not asserting a cap the library doesn't guarantee.)
    const capped = fsrsParameters({ maximumInterval: 7 })
    const cappedReference = fsrs(
      generatorParameters({
        w: default_w,
        request_retention: 0.9,
        maximum_interval: 7,
        enable_fuzz: true,
        enable_short_term: true,
        learning_steps: ['1m', '10m'],
        relearning_steps: ['10m'],
      }),
    )

    let state = newState()
    let ref: FsrsCard = createEmptyCard(T0)
    for (let i = 0; i < 8; i++) {
      const at = new Date(T0.getTime() + i * 6 * 864e5)
      state = fsrsReview(state, 4, capped, at).state
      ref = cappedReference.next(ref, at, Rating.Easy).card
      expect(state.scheduledDays).toBe(ref.scheduled_days)
    }

    // A capped scheduler must still schedule far more tightly than an uncapped
    // one, i.e. the setting genuinely reaches the library.
    let uncapped = newState()
    for (let i = 0; i < 8; i++) {
      uncapped = fsrsReview(uncapped, 4, params, new Date(T0.getTime() + i * 6 * 864e5)).state
    }
    expect(state.scheduledDays!).toBeLessThan(uncapped.scheduledDays!)
  })
})

// ── Test 7 — retrievability via the official scheduler ────────────────────────

describe('Test 7: retrievability comes from the official forgetting curve', () => {
  it('agrees with the library forgetting_curve, not the old FSRS-5 equation', () => {
    let state = fsrsReview(newState(), 3, params, T0).state
    state = fsrsReview(state, 3, params, new Date('2026-07-01T09:11:00.000Z')).state

    const at = new Date('2026-07-08T09:11:00.000Z')
    const elapsedDays = (at.getTime() - new Date(state.lastReviewedAt!).getTime()) / 864e5

    const mine = fsrsRetrievability(state, at, params)
    const official = forgetting_curve(params.w, elapsedDays, state.stability)
    expect(mine).toBe(official)

    // The retired Nemos equation was the FSRS-5 curve (fixed decay 0.5,
    // i.e. R = (1 + t/(9S))^-1). FSRS-6's decay is 0.1542, so a real FSRS-6
    // value must differ from it — this is what makes the assertion meaningful.
    const oldNemosEquation = Math.pow(1 + elapsedDays / (9 * state.stability), -1)
    expect(Math.abs(mine - oldNemosEquation)).toBeGreaterThan(0.01)
  })

  it('agrees with the scheduler own get_retrievability at day granularity', () => {
    let state = fsrsReview(newState(), 3, params, T0).state
    state = fsrsReview(state, 3, params, new Date('2026-07-01T09:11:00.000Z')).state

    // Compare on an exact-day boundary, where the scheduler's UTC-day rounding
    // and our fractional-day input coincide.
    const at = new Date(new Date(state.lastReviewedAt!).getTime() + 5 * 864e5)
    const viaScheduler = reference.get_retrievability(toFsrsCard(state), at, false)
    expect(fsrsRetrievability(state, at, params)).toBeCloseTo(viaScheduler, 6)
  })

  it('reports 0 for a card with no memory state', () => {
    expect(fsrsRetrievability(newState(), T0, params)).toBe(0)
  })

  it('decays monotonically and exposes the same curve to analytics', () => {
    const r1 = fsrsForgettingCurve(1, 10)
    const r10 = fsrsForgettingCurve(10, 10)
    const r100 = fsrsForgettingCurve(100, 10)
    expect(r1).toBeGreaterThan(r10)
    expect(r10).toBeGreaterThan(r100)
    // At t == S the curve is at the retention the definition of S implies.
    expect(fsrsForgettingCurve(10, 10)).toBeCloseTo(0.9, 2)
    expect(fsrsForgettingCurve(3, 7)).toBe(forgetting_curve(params.w, 3, 7))
  })
})

// ── Test 9 — persistence round-trip ──────────────────────────────────────────

describe('Test 9: reloading does not reset FSRS state', () => {
  it('survives a JSON serialise/deserialise cycle with identical scheduling', () => {
    let state = fsrsReview(newState(), 3, params, T0).state
    state = fsrsReview(state, 3, params, new Date('2026-07-01T09:11:00.000Z')).state
    state = fsrsReview(state, 1, params, new Date('2026-07-04T09:00:00.000Z')).state

    // Exactly what the zustand persist layer / Supabase row round-trip does.
    const reloaded = JSON.parse(JSON.stringify(state)) as FSRSState
    expect(reloaded).toEqual(state)

    const at = new Date('2026-07-04T09:12:00.000Z')
    expect(fsrsReview(reloaded, 3, params, at).state).toEqual(
      fsrsReview(state, 3, params, at).state,
    )
  })

  it('does not lose the learning-step position across a reload', () => {
    const state = fsrsReview(newState(), 3, params, T0).state
    expect(state.learningSteps).toBeGreaterThan(0)

    const reloaded = JSON.parse(JSON.stringify(state)) as FSRSState
    // Continuing from the reloaded row graduates, exactly as continuing from
    // the in-memory row does. If learning_steps were dropped, the card would
    // restart its steps here instead.
    const at = new Date('2026-07-01T09:11:00.000Z')
    expect(fsrsReview(reloaded, 3, params, at).state.state).toBe('review')
    expect(fsrsReview(reloaded, 3, params, at).state).toEqual(
      fsrsReview(state, 3, params, at).state,
    )
  })

  it('tolerates a legacy row missing the FSRS-6-only fields', () => {
    // A row persisted before the FSRS-6 migration has no learningSteps /
    // scheduledDays. The adapter must default them rather than emit NaN.
    const legacy = {
      cardId: ID.cardId,
      userId: ID.userId,
      stability: 12,
      difficulty: 5,
      retrievability: 0,
      dueDate: '2026-07-05T09:00:00.000Z',
      lastReviewedAt: '2026-06-25T09:00:00.000Z',
      repetitions: 3,
      lapses: 1,
      state: 'review',
    } as FSRSState

    const card = toFsrsCard(legacy)
    expect(card.learning_steps).toBe(0)
    expect(card.scheduled_days).toBe(0)

    const { state } = fsrsReview(legacy, 3, params, new Date('2026-07-05T09:00:00.000Z'))
    expect(Number.isFinite(state.stability)).toBe(true)
    expect(Number.isFinite(state.difficulty)).toBe(true)
    expect(state.schedulerVersion).toBe(FSRS6_SCHEDULER_VERSION)
  })
})

// ── Time / timezone handling (section 18) ────────────────────────────────────

describe('time handling', () => {
  it('uses the real review instant, not a local-midnight rounding', () => {
    const morning = new Date('2026-07-01T00:30:00.000Z')
    const evening = new Date('2026-07-01T23:30:00.000Z')

    const a = fsrsReview(newState(morning), 3, params, morning).state
    const b = fsrsReview(newState(morning), 3, params, evening).state

    // Both are the same calendar day, but the scheduled instants differ by the
    // real elapsed time — proof the timestamp is passed through verbatim.
    expect(new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime()).toBe(
      evening.getTime() - morning.getTime(),
    )
    expect(a.lastReviewedAt).toBe(morning.toISOString())
    expect(b.lastReviewedAt).toBe(evening.toISOString())
  })

  it('is stable across a midnight boundary and an overdue gap', () => {
    let state = fsrsReview(newState(), 3, params, T0).state
    state = fsrsReview(state, 3, params, new Date('2026-07-01T09:11:00.000Z')).state

    // Reviewed just before and just after local/UTC midnight, and long overdue.
    for (const iso of [
      '2026-07-03T23:59:30.000Z',
      '2026-07-04T00:00:30.000Z',
      '2026-09-01T12:00:00.000Z',
    ]) {
      const at = new Date(iso)
      const mine = fsrsReview(state, 3, params, at).state
      const ref = reference.next(toFsrsCard(state), at, Rating.Good).card
      expect(mine.stability).toBe(ref.stability)
      expect(new Date(mine.dueDate).getTime()).toBe(ref.due.getTime())
    }
  })

  it('never schedules a review card into the past', () => {
    let state = fsrsReview(newState(), 3, params, T0).state
    state = fsrsReview(state, 3, params, new Date('2026-07-01T09:11:00.000Z')).state
    const at = new Date('2026-08-15T09:00:00.000Z')
    const next = fsrsReview(state, 3, params, at).state
    expect(new Date(next.dueDate).getTime()).toBeGreaterThan(at.getTime())
  })
})
