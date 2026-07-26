/**
 * One-time migration of Nemos' scheduling state onto genuine FSRS-6.
 *
 * Why a migration is needed at all: every `fsrs_data` row written before this
 * change came out of Nemos' own hand-written scheduler. Its stability and
 * difficulty numbers are *not* FSRS-6 values — they were produced by a
 * different (and incorrect) implementation, with FSRS-5-era weights, no
 * learning-step machine, and a Nemos-specific same-day-graduation override.
 * Feeding them to FSRS-6 as if they were authoritative memory state would bake
 * that error in permanently.
 *
 * Strategy — reconstruct, don't convert:
 *
 *   A. Never-reviewed cards (`state === 'new'`, no review logs)
 *      → become genuine FSRS new cards. Nothing to preserve; the row's
 *        `dueDate` is kept because Nemos' new-card queue sorts on it.
 *
 *   B. Reviewed cards with review history
 *      → the card's real `review_logs` are **replayed through the official
 *        ts-fsrs scheduler**, oldest first, starting from a genuine empty
 *        card. The resulting stability/difficulty/state/due therefore come
 *        entirely from FSRS-6 acting on real events. No old FSRS-like value is
 *        carried across, and no review event is invented.
 *
 *   C. Reviewed cards with no surviving history
 *      → cannot be reconstructed and must not be faked, so they are reset to a
 *        genuine new card and re-learned. Counted separately in the report so
 *        this is never silent.
 *
 * Fidelity caveat, deliberately accepted: replay uses each log's *stored*
 * rating verbatim. Ratings recorded before the "Remembered" → Good fix are
 * grade 4 (Easy), so those cards replay with FSRS-6's easy bonus applied and
 * land on somewhat longer intervals than the same clicks would produce today.
 * Rewriting historical ratings would be fabricating review history, which is
 * worse; the distortion is self-correcting as new (correctly-graded) reviews
 * accumulate. See CLAUDE.md for the rating-semantics discontinuity.
 *
 * Determinism: replay is a pure function of the stored logs, so two devices
 * running it independently produce identical rows (official fuzz is seeded from
 * the review timestamp, which is part of the log).
 */

import {
  FSRS6_SCHEDULER_VERSION,
  fromFsrsCard,
  fsrsInitCard,
  fsrsRetrievability,
  fsrsScheduler,
  toFsrsGrade,
  type FSRSState,
} from './srs'
import { createEmptyCard, type Card as FsrsCard, type FSRSParameters } from 'ts-fsrs'
import type { Difficulty, ReviewLog } from './types'

export class FsrsMigrationUnsafeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FsrsMigrationUnsafeError'
  }
}

export interface FsrsMigrationReport {
  /** Rows examined. */
  scanned: number
  /** Rows already carrying FSRS-6 state — left untouched. */
  alreadyMigrated: number
  /** Case A — never-reviewed cards re-created as genuine FSRS new cards. */
  freshNew: number
  /** Case B — cards reconstructed by replaying real review logs through ts-fsrs. */
  replayed: number
  /** Case C — cards whose history is gone; reset to new rather than faked. */
  resetWithoutHistory: number
}

export const EMPTY_MIGRATION_REPORT: FsrsMigrationReport = {
  scanned: 0,
  alreadyMigrated: 0,
  freshNew: 0,
  replayed: 0,
  resetWithoutHistory: 0,
}

/** Persisted ratings are typed but not validated; the scheduler rejects out-of-range grades. */
function coerceRating(rating: number): Difficulty {
  const r = Math.round(rating)
  if (r === 1 || r === 2 || r === 3 || r === 4) return r
  // Anything else predates/violates the 1–4 contract. Treat it as a successful
  // recall (Good) rather than dropping the review event entirely, since the
  // event demonstrably happened.
  return 3
}

/**
 * Rebuild a card's FSRS-6 state by replaying its real reviews through the
 * official scheduler. `logs` need not be sorted.
 */
export function replayCardHistory(
  identity: { cardId: string; userId: string },
  logs: ReviewLog[],
  params: FSRSParameters,
): FSRSState {
  const ordered = [...logs].sort(
    (a, b) => new Date(a.reviewedAt).getTime() - new Date(b.reviewedAt).getTime(),
  )
  const scheduler = fsrsScheduler(params)

  let card: FsrsCard = createEmptyCard(new Date(ordered[0].reviewedAt))
  let retrievabilityAtLastReview = 0

  for (const log of ordered) {
    const reviewedAt = new Date(log.reviewedAt)
    // R the learner actually faced at this review, per the official curve.
    retrievabilityAtLastReview = fsrsRetrievability(
      fromFsrsCard(card, identity, 0),
      reviewedAt,
      params,
    )
    card = scheduler.next(card, reviewedAt, toFsrsGrade(coerceRating(log.rating))).card
  }

  const state = fromFsrsCard(card, identity, retrievabilityAtLastReview)
  state.updatedAt = new Date().toISOString()
  return state
}

/**
 * Migrate a whole `fsrsData` map onto FSRS-6. Pure: returns a new map plus a
 * report, and mutates nothing.
 *
 * Must be called with a *complete* review-log set (i.e. after a full pull) —
 * replaying a partial history would understate a card's progress.
 */
export function migrateFsrsToV6(input: {
  cards: { id: string; userId: string }[]
  fsrsData: Record<string, FSRSState>
  reviewLogs: ReviewLog[]
  params: FSRSParameters
}): { fsrsData: Record<string, FSRSState>; report: FsrsMigrationReport } {
  const { cards, fsrsData, reviewLogs, params } = input

  const logsByCard = new Map<string, ReviewLog[]>()
  for (const log of reviewLogs) {
    const list = logsByCard.get(log.cardId)
    if (list) list.push(log)
    else logsByCard.set(log.cardId, [log])
  }

  // Safety net for the one destructive branch (case C). An empty review-log set
  // paired with cards that claim progress is the fingerprint of a review-log
  // set that failed to load — an errored `review_logs` fetch, or a persisted
  // store read that hadn't hydrated yet. Taken at face value it would reset
  // every reviewed card, so refuse instead: unmigrated rows are simply retried
  // on the next load, whereas a wrong reset is unrecoverable.
  const reviewedRows = Object.values(fsrsData).filter(
    (f) => f.state !== 'new' && f.schedulerVersion !== FSRS6_SCHEDULER_VERSION,
  ).length
  if (reviewedRows > 0 && reviewLogs.length === 0) {
    throw new FsrsMigrationUnsafeError(
      `refusing to migrate: ${reviewedRows} card(s) have scheduling progress but the ` +
        `review-log set is empty, which almost certainly means history failed to load ` +
        `rather than that it does not exist`,
    )
  }

  const userIdByCard = new Map(cards.map((c) => [c.id, c.userId]))
  const report: FsrsMigrationReport = { ...EMPTY_MIGRATION_REPORT }
  const next: Record<string, FSRSState> = {}

  for (const [cardId, existing] of Object.entries(fsrsData)) {
    report.scanned++

    if (existing.schedulerVersion === FSRS6_SCHEDULER_VERSION) {
      report.alreadyMigrated++
      next[cardId] = existing
      continue
    }

    const identity = { cardId, userId: userIdByCard.get(cardId) ?? existing.userId }
    const logs = logsByCard.get(cardId) ?? []

    // Case A — the row says this card is new, so it becomes a genuine FSRS new
    // card. Its due date is kept (Nemos' new-card queue sorts on it).
    //
    // This branch is taken even when logs *do* exist for the card: "state:
    // new" plus surviving logs is what a deliberate per-card "Reset progress"
    // looks like (resetCardSRS clears the schedule but never prunes history).
    // Replaying those logs would silently undo the user's reset, so the row's
    // own claim wins over the history.
    if (existing.state === 'new') {
      report.freshNew++
      next[cardId] = {
        ...fsrsInitCard(identity.cardId, identity.userId),
        dueDate: existing.dueDate,
      }
      continue
    }

    // Case C — the card claims progress but no review survives to prove it.
    if (logs.length === 0) {
      report.resetWithoutHistory++
      next[cardId] = {
        ...fsrsInitCard(identity.cardId, identity.userId),
        dueDate: existing.dueDate,
      }
      continue
    }

    // Case B — reconstruct from real history via the official scheduler.
    report.replayed++
    next[cardId] = replayCardHistory(identity, logs, params)
  }

  return { fsrsData: next, report }
}
