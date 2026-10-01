/**
 * Nemos SRS adapter — a thin wrapper around the official Open Spaced
 * Repetition scheduler (`ts-fsrs`, FSRS-6).
 *
 *   Nemos UI / product logic → this adapter → ts-fsrs → FSRS-6 mathematics
 *
 * This file contains NO scheduling mathematics of its own. Every number that
 * FSRS owns — stability, difficulty, retrievability, state transitions,
 * intervals, fuzz — comes back out of the library. What lives here is purely
 * translation: Nemos' persisted `FSRSState` row shape ⇄ ts-fsrs' `Card`, and
 * Nemos' settings ⇄ ts-fsrs' `FSRSParameters`.
 *
 * Division of responsibility (do not blur these):
 *   FSRS owns  — D, S, R, memory-state transitions, interval calculation,
 *                desired retention, learning/relearning steps, fuzz.
 *   Nemos owns — the two-button UX, daily/deck limits, queue ordering and
 *                filtering, exam prioritisation, analytics presentation.
 *
 * Time handling: ts-fsrs takes and returns real `Date` instants, and its
 * internal `elapsed_days` is a *UTC* calendar-day difference
 * (`dateDiffInDays`). Nemos buckets its own queue by *local* calendar day
 * (`toLocalDateStr`). Both operate on the same absolute instants, so no
 * conversion is needed at this boundary — we always hand FSRS the real review
 * timestamp, never a local-midnight-rounded one. The two day-granularities can
 * disagree by one day for cards reviewed near midnight; that is confined to
 * FSRS' elapsed-day input and to Nemos' due-list bucketing respectively, and
 * neither leaks into the other.
 */

import {
  createEmptyCard,
  default_maximum_interval,
  default_request_retention,
  default_w,
  forgetting_curve,
  fsrs,
  generatorParameters,
  Rating,
  State,
} from 'ts-fsrs'
import type {
  Card as FsrsCard,
  FSRS,
  FSRSParameters,
  Grade,
  StepUnit,
} from 'ts-fsrs'
import type { Difficulty } from './types'

// ── Persisted Nemos row shape ─────────────────────────────────────────────────

export type NemosCardState = 'new' | 'learning' | 'review' | 'relearning'

/**
 * One `fsrs_data` row. Every field except `cardId`/`userId`/`retrievability`/
 * `updatedAt` is FSRS-owned and is only ever written from a ts-fsrs result —
 * this type is the storage projection of ts-fsrs' `Card`, not a second model.
 */
export interface FSRSState {
  cardId: string
  userId: string
  /** ← `Card.stability`. Interval (days) at which R decays to 90%. */
  stability: number
  /** ← `Card.difficulty`. 1–10. */
  difficulty: number
  /**
   * R at the moment of the last review, cached for display. Derived, never an
   * input to scheduling — live R is always recomputed via `fsrsRetrievability`
   * (official forgetting curve) rather than read from here.
   */
  retrievability: number
  /** ← `Card.due` */
  dueDate: string
  /** ← `Card.last_review` */
  lastReviewedAt: string | null
  /** ← `Card.reps` */
  repetitions: number
  /** ← `Card.lapses` */
  lapses: number
  /** ← `Card.state` */
  state: NemosCardState
  /**
   * ← `Card.learning_steps`. Index into the configured learning/relearning
   * steps. Optional only because rows persisted before the FSRS-6 migration
   * lack it; treated as 0 at the adapter boundary.
   */
  learningSteps?: number
  /**
   * ← `Card.scheduled_days`. The whole-day interval FSRS last assigned (0 for
   * a sub-day learning step). Optional for the same legacy reason as above.
   */
  scheduledDays?: number
  /**
   * Which scheduler produced this row. Absent/0 → the pre-migration custom
   * scheduler; `FSRS6_SCHEDULER_VERSION` → genuine ts-fsrs FSRS-6 output.
   * Read by `migrateFsrsToV6` (see `fsrsMigration.ts`) to know what still
   * needs reconstructing, and never to be treated as an FSRS input.
   */
  schedulerVersion?: number
  // Client-stamped on every local write (init/review/reset/undo — see
  // useLibraryStore's fsrs actions); overwritten server-side by the fsrs_data
  // updated_at DB trigger on every upsert. The sync pull merge compares this
  // against the server row's updated_at so a stale server copy can't revert a
  // newer local review (push-failure window). Optional because rows persisted
  // before this field existed lack it — those fall back to server-wins.
  updatedAt?: string
}

/** Bumped only if a future FSRS major version needs another reconstruction. */
export const FSRS6_SCHEDULER_VERSION = 6

// ── Parameters ────────────────────────────────────────────────────────────────

/** Official FSRS-6 default parameters — 21 values, `w[20]` being decay. */
export const FSRS6_DEFAULT_WEIGHTS: readonly number[] = default_w
export const FSRS_WEIGHT_COUNT = default_w.length

/**
 * Learning/relearning steps — intentionally EMPTY. A new card graduates
 * straight to `State.Review` on its first answer (any grade), and a lapse on a
 * review card stays in `State.Review` with a day-level interval. There is no
 * sub-day 1m/10m step machine.
 *
 * Same-day visibility in Reviews (the hard same-day-graduation rule, see
 * CLAUDE.md) is NOT provided by a step any more: the just-graduated card's
 * dueDate is already tomorrow+, and `graduatedTodayIds()` in useLibraryStore
 * keeps it in today's Reviews regardless of dueDate until it is answered there.
 * That same-day Reviews answer then goes through FSRS-6's short-term stability
 * path (`enable_short_term`), which is what earns the longer first gap.
 *
 * Legacy rows persisted in 'learning'/'relearning' with `learningSteps > 0`
 * self-heal: with empty steps the step strategy returns no step, so their next
 * answer lands in `State.Review` with a real FSRS interval.
 */
export const LEARNING_STEPS: readonly StepUnit[] = []
export const RELEARNING_STEPS: readonly StepUnit[] = []

/**
 * The three FSRS knobs Nemos persists in `useSettingsStore` / syncs via
 * `user_settings`. Everything else about the scheduler is the library default.
 */
export interface NemosFsrsSettings {
  weights?: number[] | readonly number[]
  targetRetention?: number
  maximumInterval?: number
}

/** Defaults for `useSettingsStore` — pure FSRS-6 official configuration. */
export const DEFAULT_FSRS_PARAMS: {
  weights: number[]
  targetRetention: number
  maximumInterval: number
} = {
  weights: [...default_w],
  targetRetention: default_request_retention,
  maximumInterval: default_maximum_interval,
}

/**
 * A weight array is only usable if it is a full FSRS-6 parameter vector.
 *
 * A 17-value array is a leftover FSRS-5 vector (either the pre-migration Nemos
 * defaults or a value produced by the removed home-grown optimizer). We
 * deliberately do NOT run it through `migrateParameters`: that pads to 21 while
 * keeping the old FSRS-5 values and an FSRS-5 decay, i.e. it would smuggle the
 * old implementation's numbers into FSRS-6. Such arrays are discarded in favour
 * of the official defaults instead.
 */
export function isValidFsrsWeights(w: unknown): w is number[] {
  return (
    Array.isArray(w) &&
    w.length === FSRS_WEIGHT_COUNT &&
    w.every((n) => typeof n === 'number' && Number.isFinite(n))
  )
}

/** Build official `FSRSParameters` from Nemos' persisted settings. */
export function fsrsParameters(settings: NemosFsrsSettings = {}): FSRSParameters {
  return generatorParameters({
    w: isValidFsrsWeights(settings.weights) ? settings.weights : default_w,
    request_retention: settings.targetRetention ?? default_request_retention,
    maximum_interval: settings.maximumInterval ?? default_maximum_interval,
    // Official FSRS fuzz — spreads same-interval cards across nearby days so
    // review load doesn't clump. Nemos adds no fuzz of its own on top.
    enable_fuzz: true,
    // FSRS-6 short-term stability for same-day reviews. MUST stay true: it is
    // what makes the same-day Reviews answer of a just-graduated card count.
    enable_short_term: true,
    // Steps are intentionally empty — a new card graduates on its first
    // answer; same-day visibility in Reviews is provided by graduatedTodayIds()
    // in useLibraryStore, NOT by a sub-day step.
    learning_steps: [...LEARNING_STEPS],
    relearning_steps: [...RELEARNING_STEPS],
  })
}

/** Scheduler instances are stateless w.r.t. cards; cache one per parameter set. */
const schedulerCache = new Map<string, FSRS>()

export function fsrsScheduler(params: FSRSParameters): FSRS {
  const key = JSON.stringify([
    params.w,
    params.request_retention,
    params.maximum_interval,
    params.enable_fuzz,
    params.enable_short_term,
    params.learning_steps,
    params.relearning_steps,
  ])
  let instance = schedulerCache.get(key)
  if (!instance) {
    instance = fsrs(params)
    schedulerCache.set(key, instance)
  }
  return instance
}

// ── Rating mapping: Nemos' two-button UX → FSRS grades ────────────────────────

/**
 * Nemos' study session shows exactly two buttons. Their FSRS meaning:
 *
 *   Forgot      → Rating.Again (1)
 *   Remembered  → Rating.Good  (3)
 *
 * "Remembered" is **Good, not Easy**. Easy is FSRS' "recalled with no effort at
 * all" signal and carries the `w[16]` easy bonus; using it for an ordinary
 * successful recall systematically over-extends every interval. (Nemos shipped
 * that bug once — see CLAUDE.md — and grade 3 is also the standard mapping the
 * FSRS community uses for a collapsed two-button UI.)
 *
 * Hard (2) is intentionally unmapped: there is no Nemos interaction that means
 * "remembered, but with difficulty". Easy (4) is reachable only from the
 * optional 4-button "More ratings" panel, which is an explicit power-user
 * escape hatch rather than part of the two-button flow.
 */
export const NEMOS_FORGOT_GRADE = Rating.Again
export const NEMOS_REMEMBERED_GRADE = Rating.Good

const NEMOS_RATING_TO_GRADE: Record<Difficulty, Grade> = {
  1: Rating.Again,
  2: Rating.Hard,
  3: Rating.Good,
  4: Rating.Easy,
}

/** Nemos' 1–4 `Difficulty` → the library's `Grade` enum. */
export function toFsrsGrade(rating: Difficulty): Grade {
  return NEMOS_RATING_TO_GRADE[rating]
}

// ── Card state mapping ────────────────────────────────────────────────────────

const STATE_TO_NEMOS: Record<State, NemosCardState> = {
  [State.New]: 'new',
  [State.Learning]: 'learning',
  [State.Review]: 'review',
  [State.Relearning]: 'relearning',
}

const NEMOS_TO_STATE: Record<NemosCardState, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
}

/** Nemos row → the `Card` the official scheduler consumes. */
export function toFsrsCard(state: FSRSState): FsrsCard {
  return {
    due: new Date(state.dueDate),
    stability: state.stability,
    difficulty: state.difficulty,
    // Recomputed by the scheduler from `last_review` vs. the review time, so
    // the value passed in is never read. Deprecated upstream in ts-fsrs v6.
    elapsed_days: 0,
    scheduled_days: state.scheduledDays ?? 0,
    learning_steps: state.learningSteps ?? 0,
    reps: state.repetitions,
    lapses: state.lapses,
    state: NEMOS_TO_STATE[state.state],
    last_review: state.lastReviewedAt ? new Date(state.lastReviewedAt) : undefined,
  }
}

/** Scheduler result `Card` → Nemos row, preserving Nemos-owned identity fields. */
export function fromFsrsCard(
  card: FsrsCard,
  identity: { cardId: string; userId: string },
  retrievabilityAtReview: number,
): FSRSState {
  return {
    cardId: identity.cardId,
    userId: identity.userId,
    stability: card.stability,
    difficulty: card.difficulty,
    retrievability: retrievabilityAtReview,
    dueDate: card.due.toISOString(),
    lastReviewedAt: card.last_review ? card.last_review.toISOString() : null,
    repetitions: card.reps,
    lapses: card.lapses,
    state: STATE_TO_NEMOS[card.state],
    learningSteps: card.learning_steps,
    scheduledDays: card.scheduled_days,
    schedulerVersion: FSRS6_SCHEDULER_VERSION,
  }
}

// ── Card creation ─────────────────────────────────────────────────────────────

/**
 * A genuine FSRS new card (`createEmptyCard`), plus Nemos' identity and sync
 * stamp. `due` is "now", which is also what Nemos' new-card queue sorts on.
 */
export function fsrsInitCard(cardId: string, userId: string, now: Date = new Date()): FSRSState {
  const state = fromFsrsCard(createEmptyCard(now), { cardId, userId }, 0)
  state.updatedAt = new Date().toISOString()
  return state
}

/**
 * Init state for a card that should already have one but doesn't — a trash
 * restore whose entry carried no FSRS snapshot, a legacy backup that predates
 * FSRS export, or a card whose fsrs row was lost. Identical to fsrsInitCard
 * minus the updatedAt stamp: an unstamped row is the weakest possible claim
 * in the sync layer — the pull merge (pickFresherFsrs) lets any server row
 * win over it, and the push sends unstamped rows insert-only (never
 * overwriting) — so if the card's real scheduling state still exists
 * anywhere (server, another device), it always beats this placeholder.
 */
export function fsrsBackfillCard(cardId: string, userId: string): FSRSState {
  const init = fsrsInitCard(cardId, userId)
  delete init.updatedAt
  return init
}

// ── Review ────────────────────────────────────────────────────────────────────

export interface FsrsReviewResult {
  /** The new persisted row, entirely FSRS-derived. */
  state: FSRSState
  /**
   * The official scheduler's whole-day interval for this review
   * (`ReviewLog.scheduled_days`) — 0 for a sub-day learning/relearning step.
   */
  scheduledDays: number
  /** R at the moment of this review, per the official forgetting curve. */
  retrievability: number
}

/**
 * Schedule one review. This is the single scheduling entry point in Nemos —
 * every rating, preview and replay goes through here, and the returned numbers
 * are exactly what `ts-fsrs` produced.
 */
export function fsrsReview(
  state: FSRSState,
  rating: Difficulty,
  params: FSRSParameters,
  reviewedAt: Date = new Date(),
): FsrsReviewResult {
  const retrievability = fsrsRetrievability(state, reviewedAt, params)
  const { card, log } = fsrsScheduler(params).next(
    toFsrsCard(state),
    reviewedAt,
    toFsrsGrade(rating),
  )
  return {
    state: fromFsrsCard(card, { cardId: state.cardId, userId: state.userId }, retrievability),
    scheduledDays: log.scheduled_days,
    retrievability,
  }
}

// ── Retrievability ────────────────────────────────────────────────────────────

const defaultParams = fsrsParameters()

/**
 * The official FSRS-6 forgetting curve, `R = (1 + FACTOR·t/(9S))^DECAY` with
 * decay = −w[20]. Exposed for analytics that reconstruct R from review logs
 * rather than from a live card, so no caller has to restate the equation.
 */
export function fsrsForgettingCurve(
  elapsedDays: number,
  stability: number,
  params: FSRSParameters = defaultParams,
): number {
  return forgetting_curve(params.w, Math.max(0, elapsedDays), Math.max(0.001, stability))
}

/**
 * Probability of recall at `at`, via the library's exported `forgetting_curve`
 * — the same FSRS-6 curve (`R = (1 + FACTOR·t/(9S))^DECAY`, decay = −w[20]) the
 * scheduler itself uses. Passed a fractional elapsed-day count rather than the
 * scheduler's UTC-day-rounded one, because Nemos' callers (exam prediction,
 * mastery display) need sub-day resolution and future dates.
 *
 * Returns 0 for a card FSRS considers to have no memory state yet.
 */
export function fsrsRetrievability(
  state: FSRSState,
  at: Date = new Date(),
  params: FSRSParameters = defaultParams,
): number {
  if (state.state === 'new' || !state.lastReviewedAt || state.stability <= 0) return 0
  const elapsedDays = Math.max(
    0,
    (at.getTime() - new Date(state.lastReviewedAt).getTime()) / 86400000,
  )
  return forgetting_curve(params.w, elapsedDays, state.stability)
}
