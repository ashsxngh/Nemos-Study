/**
 * Test 10 — existing cards are not silently corrupted by the FSRS-6 migration.
 *
 * The migration's job is to replace state produced by the retired custom
 * scheduler with genuine FSRS-6 state, reconstructed by replaying real review
 * logs through the official library. These tests pin down that it (a) really
 * uses the library, (b) never invents history, (c) never destroys a card's
 * identity or progress it can reconstruct, and (d) is idempotent.
 */

import { describe, expect, it } from 'vitest'
import { createEmptyCard, fsrs, generatorParameters, default_w, Rating } from 'ts-fsrs'
import type { Card as FsrsCard } from 'ts-fsrs'
import { FsrsMigrationUnsafeError, migrateFsrsToV6, replayCardHistory } from './fsrsMigration'
import { FSRS6_SCHEDULER_VERSION, fsrsParameters, type FSRSState } from './srs'
import type { ReviewLog } from './types'

const USER = 'user-1'
const CARD_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CARD_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const CARD_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const params = fsrsParameters()
const reference = fsrs(
  generatorParameters({
    w: default_w,
    request_retention: 0.9,
    maximum_interval: 36500,
    enable_fuzz: true,
    enable_short_term: true,
    learning_steps: [],
    relearning_steps: [],
  }),
)

let logSeq = 0
function log(cardId: string, reviewedAt: string, rating: 1 | 2 | 3 | 4): ReviewLog {
  return {
    id: `log-${++logSeq}`,
    sessionId: 'session-1',
    cardId,
    userId: USER,
    rating,
    responseMs: 4200,
    reviewedAt,
    scheduledInterval: 1,
    ease: 5,
  }
}

/** A row as written by the retired custom scheduler — note: no schedulerVersion. */
function legacyRow(cardId: string, overrides: Partial<FSRSState> = {}): FSRSState {
  return {
    cardId,
    userId: USER,
    // Values only the old implementation would produce (w[3] = 15.4722 was its
    // Easy initial stability, and it wrote 'learning' with a multi-day due).
    stability: 15.4722,
    difficulty: 3.283,
    retrievability: 0,
    dueDate: '2026-07-20T00:00:00.000Z',
    lastReviewedAt: '2026-07-05T10:00:00.000Z',
    repetitions: 1,
    lapses: 0,
    state: 'learning',
    ...overrides,
  }
}

describe('replayCardHistory', () => {
  it('reproduces exactly what the official scheduler produces for the same events', () => {
    const events: { at: string; rating: 1 | 3 }[] = [
      { at: '2026-06-01T09:00:00.000Z', rating: 3 },
      { at: '2026-06-01T09:11:00.000Z', rating: 3 },
      { at: '2026-06-05T08:00:00.000Z', rating: 1 },
      { at: '2026-06-05T08:12:00.000Z', rating: 3 },
      { at: '2026-06-12T19:30:00.000Z', rating: 3 },
    ]

    const replayed = replayCardHistory(
      { cardId: CARD_A, userId: USER },
      events.map((e) => log(CARD_A, e.at, e.rating)),
      params,
    )

    let ref: FsrsCard = createEmptyCard(new Date(events[0].at))
    for (const e of events) {
      ref = reference.next(ref, new Date(e.at), e.rating === 1 ? Rating.Again : Rating.Good).card
    }

    expect(replayed.stability).toBe(ref.stability)
    expect(replayed.difficulty).toBe(ref.difficulty)
    expect(replayed.repetitions).toBe(ref.reps)
    expect(replayed.lapses).toBe(ref.lapses)
    expect(replayed.learningSteps).toBe(ref.learning_steps)
    expect(replayed.scheduledDays).toBe(ref.scheduled_days)
    expect(new Date(replayed.dueDate).getTime()).toBe(ref.due.getTime())
    expect(replayed.lastReviewedAt).toBe(ref.last_review?.toISOString())
    expect(replayed.schedulerVersion).toBe(FSRS6_SCHEDULER_VERSION)
  })

  it('carries no trace of the old implementation numbers', () => {
    const replayed = replayCardHistory(
      { cardId: CARD_A, userId: USER },
      [log(CARD_A, '2026-06-01T09:00:00.000Z', 4)],
      params,
    )
    // 15.4722 was the retired scheduler's w[3] initial stability for Easy; a
    // genuine FSRS-6 first-Easy stability is w[3] = 8.2956.
    expect(replayed.stability).not.toBeCloseTo(15.4722, 3)
    expect(replayed.stability).toBeCloseTo(default_w[3], 6)
  })

  it('is order-insensitive — logs are sorted before replay', () => {
    const events: [string, 1 | 3][] = [
      ['2026-06-01T09:00:00.000Z', 3],
      ['2026-06-01T09:11:00.000Z', 3],
      ['2026-06-09T09:00:00.000Z', 1],
    ]
    const ordered = events.map(([at, r]) => log(CARD_A, at, r))
    const shuffled = [ordered[2], ordered[0], ordered[1]]

    const a = replayCardHistory({ cardId: CARD_A, userId: USER }, ordered, params)
    const b = replayCardHistory({ cardId: CARD_A, userId: USER }, shuffled, params)
    expect({ ...a, updatedAt: null }).toEqual({ ...b, updatedAt: null })
  })

  it('is deterministic, so two devices migrate to identical rows', () => {
    const logs = [
      log(CARD_A, '2026-06-01T09:00:00.000Z', 3),
      log(CARD_A, '2026-06-01T09:11:00.000Z', 3),
      log(CARD_A, '2026-06-20T09:00:00.000Z', 3),
    ]
    const deviceA = replayCardHistory({ cardId: CARD_A, userId: USER }, logs, params)
    const deviceB = replayCardHistory({ cardId: CARD_A, userId: USER }, logs, params)
    expect({ ...deviceA, updatedAt: null }).toEqual({ ...deviceB, updatedAt: null })
  })
})

describe('migrateFsrsToV6', () => {
  const cards = [CARD_A, CARD_B, CARD_C].map((id) => ({ id, userId: USER }))

  it('reconstructs a reviewed card from its real logs (case B)', () => {
    const logs = [
      log(CARD_A, '2026-06-01T09:00:00.000Z', 3),
      log(CARD_A, '2026-06-01T09:11:00.000Z', 3),
      log(CARD_A, '2026-06-06T09:00:00.000Z', 3),
    ]
    const { fsrsData, report } = migrateFsrsToV6({
      cards,
      fsrsData: { [CARD_A]: legacyRow(CARD_A, { state: 'review' }) },
      reviewLogs: logs,
      params,
    })

    expect(report.replayed).toBe(1)
    expect(report.freshNew).toBe(0)
    expect(report.resetWithoutHistory).toBe(0)

    const row = fsrsData[CARD_A]
    expect(row.schedulerVersion).toBe(FSRS6_SCHEDULER_VERSION)
    // Identity preserved.
    expect(row.cardId).toBe(CARD_A)
    expect(row.userId).toBe(USER)
    // Progress preserved — the card is still a learned card, not reset.
    expect(row.state).not.toBe('new')
    expect(row.repetitions).toBe(3)
    expect(row.stability).toBeGreaterThan(0)
    // And it equals a straight replay, i.e. the library did the work.
    expect({ ...row, updatedAt: null }).toEqual({
      ...replayCardHistory({ cardId: CARD_A, userId: USER }, logs, params),
      updatedAt: null,
    })
  })

  it('re-creates a never-reviewed card as a genuine FSRS new card, keeping queue order (case A)', () => {
    const due = '2026-05-02T07:00:00.000Z'
    const { fsrsData, report } = migrateFsrsToV6({
      cards,
      fsrsData: {
        [CARD_B]: legacyRow(CARD_B, {
          state: 'new',
          stability: 0,
          difficulty: 0,
          repetitions: 0,
          lastReviewedAt: null,
          dueDate: due,
        }),
      },
      reviewLogs: [],
      params,
    })

    expect(report.freshNew).toBe(1)
    const row = fsrsData[CARD_B]
    expect(row.state).toBe('new')
    expect(row.stability).toBe(0)
    expect(row.difficulty).toBe(0)
    expect(row.lastReviewedAt).toBeNull()
    // The new-card queue sorts on dueDate — it must not be reset to "now".
    expect(row.dueDate).toBe(due)
    expect(row.schedulerVersion).toBe(FSRS6_SCHEDULER_VERSION)
  })

  it('does not resurrect a card the user deliberately reset, even though logs survive', () => {
    // resetCardSRS sets state back to 'new' but never prunes review_logs.
    // Replaying them would undo the reset, so the row's own claim must win.
    const { fsrsData, report } = migrateFsrsToV6({
      cards,
      fsrsData: {
        [CARD_C]: legacyRow(CARD_C, {
          state: 'new',
          stability: 0,
          difficulty: 0,
          repetitions: 0,
          lastReviewedAt: null,
        }),
      },
      reviewLogs: [
        log(CARD_C, '2026-05-01T09:00:00.000Z', 3),
        log(CARD_C, '2026-05-01T09:11:00.000Z', 3),
      ],
      params,
    })

    expect(report.freshNew).toBe(1)
    expect(report.replayed).toBe(0)
    expect(fsrsData[CARD_C].state).toBe('new')
    expect(fsrsData[CARD_C].repetitions).toBe(0)
  })

  it('resets a card claiming progress with no surviving history, and reports it (case C)', () => {
    // A log for a *different* card, so the whole-log-set safety guard doesn't
    // fire — this card's own history is genuinely gone.
    const { fsrsData, report } = migrateFsrsToV6({
      cards,
      fsrsData: { [CARD_A]: legacyRow(CARD_A, { state: 'review' }) },
      reviewLogs: [log(CARD_B, '2026-06-01T09:00:00.000Z', 3)],
      params,
    })

    // Never silent: the loss is counted in its own bucket.
    expect(report.resetWithoutHistory).toBe(1)
    expect(report.replayed).toBe(0)
    expect(fsrsData[CARD_A].state).toBe('new')
    expect(fsrsData[CARD_A].schedulerVersion).toBe(FSRS6_SCHEDULER_VERSION)
  })

  it('refuses to run when reviewed cards exist but the log set is empty', () => {
    // The fingerprint of history that failed to load (errored review_logs
    // fetch, or a persisted store read before hydration finished). Resetting
    // every reviewed card on that basis would be unrecoverable, so it throws
    // and the caller leaves local state untouched to retry later.
    expect(() =>
      migrateFsrsToV6({
        cards,
        fsrsData: {
          [CARD_A]: legacyRow(CARD_A, { state: 'review' }),
          [CARD_C]: legacyRow(CARD_C, { state: 'relearning' }),
        },
        reviewLogs: [],
        params,
      }),
    ).toThrow(FsrsMigrationUnsafeError)
  })

  it('still migrates an all-new dataset with no logs (nothing to lose)', () => {
    const { report } = migrateFsrsToV6({
      cards,
      fsrsData: {
        [CARD_A]: legacyRow(CARD_A, { state: 'new', stability: 0, difficulty: 0, repetitions: 0, lastReviewedAt: null }),
      },
      reviewLogs: [],
      params,
    })
    expect(report.freshNew).toBe(1)
  })

  it('still runs when logs exist for some cards but not the reviewed one', () => {
    // Genuinely-missing history for one card is a real case-C reset; the guard
    // must only fire when the *whole* log set is missing.
    const { report, fsrsData } = migrateFsrsToV6({
      cards,
      fsrsData: {
        [CARD_A]: legacyRow(CARD_A, { state: 'review' }),
        [CARD_C]: legacyRow(CARD_C, { state: 'review' }),
      },
      reviewLogs: [log(CARD_A, '2026-06-01T09:00:00.000Z', 3)],
      params,
    })
    expect(report.replayed).toBe(1)
    expect(report.resetWithoutHistory).toBe(1)
    expect(fsrsData[CARD_A].state).not.toBe('new')
    expect(fsrsData[CARD_C].state).toBe('new')
  })

  it('is idempotent — a second run changes nothing', () => {
    const logs = [
      log(CARD_A, '2026-06-01T09:00:00.000Z', 3),
      log(CARD_A, '2026-06-01T09:11:00.000Z', 3),
    ]
    const input = {
      cards,
      fsrsData: {
        [CARD_A]: legacyRow(CARD_A, { state: 'review' }),
        [CARD_B]: legacyRow(CARD_B, { state: 'new', stability: 0, difficulty: 0, repetitions: 0, lastReviewedAt: null }),
      },
      reviewLogs: logs,
      params,
    }

    const first = migrateFsrsToV6(input)
    const second = migrateFsrsToV6({ ...input, fsrsData: first.fsrsData })

    expect(second.report.alreadyMigrated).toBe(2)
    expect(second.report.replayed).toBe(0)
    expect(second.report.freshNew).toBe(0)
    expect(second.fsrsData).toEqual(first.fsrsData)
  })

  it('does not mutate its input and loses no rows', () => {
    const original = legacyRow(CARD_A, { state: 'review' })
    const snapshot = JSON.parse(JSON.stringify(original))
    const fsrsData = {
      [CARD_A]: original,
      [CARD_B]: legacyRow(CARD_B, { state: 'new', stability: 0, difficulty: 0, repetitions: 0, lastReviewedAt: null }),
      [CARD_C]: legacyRow(CARD_C, { state: 'relearning' }),
    }

    const result = migrateFsrsToV6({
      cards,
      fsrsData,
      reviewLogs: [log(CARD_A, '2026-06-01T09:00:00.000Z', 3)],
      params,
    })

    expect(original).toEqual(snapshot)
    expect(Object.keys(result.fsrsData).sort()).toEqual([CARD_A, CARD_B, CARD_C].sort())
    expect(result.report.scanned).toBe(3)
    // Every row ends up on FSRS-6.
    for (const row of Object.values(result.fsrsData)) {
      expect(row.schedulerVersion).toBe(FSRS6_SCHEDULER_VERSION)
    }
  })

  it('replays pre-fix grade-4 history verbatim rather than rewriting ratings', () => {
    // 94% of Nemos' early logs are grade 4, from the Remembered→Easy bug.
    // The migration must not "correct" them — that would be fabricating
    // history. Replaying Easy must therefore differ from replaying Good.
    const at = ['2026-06-01T09:00:00.000Z', '2026-06-01T09:11:00.000Z', '2026-06-10T09:00:00.000Z']
    const asEasy = replayCardHistory(
      { cardId: CARD_A, userId: USER },
      at.map((t) => log(CARD_A, t, 4)),
      params,
    )
    const asGood = replayCardHistory(
      { cardId: CARD_A, userId: USER },
      at.map((t) => log(CARD_A, t, 3)),
      params,
    )
    expect(asEasy.stability).toBeGreaterThan(asGood.stability)
    expect(asEasy.difficulty).toBeLessThan(asGood.difficulty)
  })

  // Real review sequences taken verbatim from the live Nemos database, chosen
  // for the shapes most likely to break a replay: same-second repeats, a lapse
  // recovered minutes later, long overdue gaps, and consecutive lapses.
  const realSequences: { name: string; events: [string, 1 | 3 | 4][] }[] = [
    {
      name: 'lapse recovered 44s later, then week-long gaps (8 reviews)',
      events: [
        ['2026-07-10T16:01:22.121Z', 4],
        ['2026-07-12T07:48:24.705Z', 1],
        ['2026-07-12T07:49:08.108Z', 4],
        ['2026-07-12T13:28:05.568Z', 4],
        ['2026-07-13T05:09:29.786Z', 4],
        ['2026-07-16T06:22:25.835Z', 4],
        ['2026-07-17T05:19:58.303Z', 4],
        ['2026-07-18T05:34:34.563Z', 4],
      ],
    },
    {
      name: 'three consecutive lapses then a recall',
      events: [
        ['2026-07-07T15:40:28.472Z', 4],
        ['2026-07-21T11:36:51.759Z', 1],
        ['2026-07-23T10:07:04.540Z', 1],
        ['2026-07-25T06:30:04.387Z', 1],
        ['2026-07-25T16:50:43.677Z', 3],
      ],
    },
    {
      name: 'two reviews 8 seconds apart, then a lapse',
      events: [
        ['2026-07-19T08:15:56.231Z', 3],
        ['2026-07-19T08:16:04.057Z', 3],
        ['2026-07-22T09:53:29.753Z', 3],
        ['2026-07-22T10:19:29.171Z', 3],
        ['2026-07-25T16:41:27.188Z', 1],
      ],
    },
    {
      name: 'two reviews 6 seconds apart at the end of a run',
      events: [
        ['2026-07-10T15:56:03.222Z', 4],
        ['2026-07-10T16:01:34.436Z', 4],
        ['2026-07-12T07:48:40.467Z', 4],
        ['2026-07-12T13:28:13.056Z', 4],
        ['2026-07-13T05:09:59.260Z', 4],
        ['2026-07-13T05:10:05.416Z', 4],
      ],
    },
    {
      name: 'single review only',
      events: [['2026-07-18T06:17:30.730Z', 4]],
    },
  ]

  for (const { name, events } of realSequences) {
    it(`replays a real Nemos history identically to the library — ${name}`, () => {
      const replayed = replayCardHistory(
        { cardId: CARD_A, userId: USER },
        events.map(([t, r]) => log(CARD_A, t, r)),
        params,
      )

      let ref: FsrsCard = createEmptyCard(new Date(events[0][0]))
      for (const [t, r] of events) {
        ref = reference.next(ref, new Date(t), r === 1 ? Rating.Again : r === 3 ? Rating.Good : Rating.Easy).card
      }

      expect(replayed.stability).toBe(ref.stability)
      expect(replayed.difficulty).toBe(ref.difficulty)
      expect(replayed.repetitions).toBe(ref.reps)
      expect(replayed.lapses).toBe(ref.lapses)
      expect(replayed.learningSteps).toBe(ref.learning_steps)
      expect(new Date(replayed.dueDate).getTime()).toBe(ref.due.getTime())
      // Sanity: a card with real history never lands back in 'new'.
      expect(replayed.state).not.toBe('new')
      expect(replayed.stability).toBeGreaterThan(0)
      expect(replayed.difficulty).toBeGreaterThanOrEqual(1)
      expect(replayed.difficulty).toBeLessThanOrEqual(10)
    })
  }

  it('keeps a rating outside 1-4 usable instead of dropping the review event', () => {
    const bad = { ...log(CARD_A, '2026-06-01T09:00:00.000Z', 3), rating: 0 as unknown as 3 }
    const row = replayCardHistory({ cardId: CARD_A, userId: USER }, [bad], params)
    expect(row.state).not.toBe('new')
    expect(Number.isFinite(row.stability)).toBe(true)
  })
})
