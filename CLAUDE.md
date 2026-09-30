@AGENTS.md

# Rules

These are permanent product invariants. They outrank any individual fix, audit
finding, refactor or cleanup. If a change you are about to make would affect
one of them as a side effect, STOP and flag it before proceeding.

## Same-day graduation (HARD, PERMANENT, NON-NEGOTIABLE)

**Same-day graduation is a hard, permanent requirement. Never remove, gate, or
delay it as a side effect of any other fix. Only change this behavior if
explicitly instructed to change same-day graduation specifically.**

Concretely, a newly learned card MUST:

1. Graduate into Reviews on the **same day** it is first learned.
2. Be **visible and answerable** in Reviews that same day (inbox, Reviews page,
   session queue), and be counted in the due badges.
3. Only stop counting as due **after it has actually been answered as a review**
   that day — never before.

This has been true throughout the project's life. A fix for something else
(counters, due-date recounting, `answeredToday` checks, exam pull-forward,
daily limits, anything) is NEVER grounds to touch it. Note the distinction that
has broken it before: *"don't re-count a card that was already answered today"*
and *"don't show a card that graduated today"* are two different rules, and
only the first one is wanted.

Guard rails: `src/store/sameDayGraduation.test.ts` locks the full lifecycle
down. If it fails, the bug is in your change. The mechanism lives in
`graduatedTodayIds()` in `src/store/useLibraryStore.ts`, which every
`answeredToday()` gate must be paired with.

# Sync architecture (`src/hooks/useSync.ts`)

`useSync` is a single React hook mounted once at the app layout level. It owns all Supabase communication.

## Key module-level singletons

These live outside the hook and persist for the entire browser session:

- `lastPushedFsrs` — Map of `cardId → JSON` used for dirty tracking; prevents re-upserting unchanged FSRS rows on every debounce cycle. Seeded from server on each pull. Cleaned up when cards are deleted.
- `pushedLogIds` — Set of review log IDs already pushed. Cleared (then re-seeded) at the start of every full pull to prevent unbounded growth.
- `preExistingIds` / `preExistingSnapshotTaken` — Snapshot of localStorage IDs taken once per session before the first pull, used to distinguish "deleted on another device" from "created this session before push completed."

## `applyingRemoteRef` — the push-loop guard

**Rule: every `useLibraryStore.setState()` call that originates from a remote source (Supabase Realtime or BroadcastChannel) must be bracketed with `applyingRemoteRef.current = true/false`.**

The library store subscriber (`useLibraryStore.subscribe`) schedules a debounced push on any state change. Without the flag, every incoming realtime event echoes back as a phantom push of all folders/decks/cards — creating a self-sustaining loop with no user interaction. The flag is checked in the subscriber as an early return (`if (applyingRemoteRef.current) return`).

The exams and settings subscribers also check this flag. Notes have no Realtime subscription so they don't need it.

## Pull watermark

`sessionStorage` key `nemos-last-pull-at` stores the ISO timestamp of the last successful pull. Present → incremental pull (only rows changed since then). Absent → full pull (new tab or first load). `incremental` is the local variable that gates this throughout `runPull`.

## Cross-tab coordination

- **Web Lock** `'nemos-sync-push'` — serialises pushes across all open tabs. Auto-released when the lock callback resolves.
- **Web Lock** `'nemos-sync-leader'` — leader election. The tab that acquires it holds the lock (via a promise that never resolves) for its lifetime; `isLeaderRef` is `true` only in that tab. Auto-released on tab close/reload so another tab picks up leadership. Gates the periodic/visibility pull below so N open tabs don't all hit Supabase at once — non-leader tabs stay current via Realtime + BroadcastChannel instead.
- **BroadcastChannel** `'nemos-sync'` — tabs post messages after a push so peers can apply deletions and settings changes immediately rather than waiting for their next pull.

## Periodic / visibility pull

Besides the mount-time pull, the leader tab also calls `pullFromSupabase()` (incremental — it reuses the `nemos-last-pull-at` watermark, same as any other pull after the first) on a `visibilitychange` event (tab becomes visible again) and every 5 minutes via `setInterval` while active. This is what keeps a tab open all day from drifting out of sync with `fsrs_data` changes made on another device — the `review_logs` Realtime feed alone doesn't carry those scheduling updates.

# Deck Study popup (`src/components/library/StudyModePopup.tsx`)

Three modes: `deck-reviews`, `deck-new`, `deck-both`. All are deck-scoped and bypass the daily new-card limit (that limit is inbox-only).

## New-card count input

When the user selects **New Cards** or **Both** and the deck has at least one new card, the popup enters a two-step flow:
1. Mode button click → selects/highlights the mode and reveals a number input defaulting to `getDeckNewAll(deckId).length`.
2. **Start** button → navigates to `/study/session?deck=…&mode=…&newCount=N`.

Reviews mode still navigates immediately (no input). Both mode with zero new cards also navigates immediately.

The `?newCount=N` param is read in `session/page.tsx` as `deckNewCount`. In `buildQueue`:
- `deck-new`: slices `getDeckNewAll` to `deckNewCount`.
- `deck-both`: replicates the interleave logic inline (reviews unlimited, new cards capped at `deckNewCount`).
- `deck-reviews`: unaffected — no new-card count applies.

`deckNewCount` is in `buildQueue`'s `useCallback` dep array. Do **not** touch `newCardsPerDay`, `useSettingsStore`, or the daily new-card tracking — this feature is entirely separate from the automatic inbox limit.

## Session Log

**Four medium-priority bugs (codebase audit).** `pruneHistory` now returns removed `{sessionIds, logIds}` instead of dropping them; `PendingDeletes` gained `sessions`/`reviewLogs` buckets wired through delete/push/pull/cross-tab paths; `runPull` tracks `anyError` across all ten tables and skips `setLastPullAt` on any table error (was incremental-only); added `burnoutTimeWarningEnabled` (separate from `burnoutWarningEnabled`) for the projected-study-time toggle; trash "Clear all" now awaits all deletes before clearing/closing, and `deleteFromSupabase` now also deletes `fsrs_data` rows (previously orphaned server-side).

### Code quality audit
"Cards reviewed"/"Total reviews" deduped by cardId. Built missing password-reset flow (`forgot-password`/`reset-password` pages + proxy bypass). Planner tasks moved from local `useState` (reset on nav) into persisted `useAppStore`. Extracted shared `FolderTreePicker` helpers, a `Menu.tsx` dropdown primitive (replacing 3 hand-rolled dropdowns), `deleteUndo.ts` (restore-from-trash + undo tracker), `generateId()` (replacing `Math.random` ids, sync channel names excluded). Removed dead notification toggles with no backing setting. New `SettingsShared.tsx` deduped ~900 lines of byte-identical code between `SettingsPage`/`SettingsPanel`.

### Performance + security audit
Converted whole-store subscriptions to granular selectors + `useShallow` across ~30 files (Settings pages left as whole-object reads deliberately — not on hot path). Wrapped render-time query calls (`getDueCards` etc.) in `useMemo`. `getNewCards` now precomputes a Set instead of O(cards×logs) scan. Added `updateCardsBatch`/`deleteCardsBatch` for single-setState bulk ops (bulk delete of 500 cards was previously 500 full clones). `deleteFromSupabase` uses cached user id instead of an extra auth round-trip. New `src/lib/limits.ts` (CARD_TEXT_MAX 10k, NOTE_CONTENT_MAX 100k, NAME_MAX 255) enforced both at store level (survives import/CSV) and input `maxLength`.

### Architecture audit — three remaining sync gaps
Added leader-election Web Lock (`nemos-sync-leader`) gating a periodic (5-min)/visibility incremental pull so idle tabs don't drift on fsrs_data changes not carried by the review_logs realtime feed. `user_settings` sync expanded from `newCardsPerDay`-only to full `fsrs_weights`/`target_retention`/`daily_review_limit`/`algorithm` (needs manual `ALTER TABLE`, not auto-applied) — previously two devices could schedule differently. Added `dropStaleOverwrites` CAS guard (compares local `updatedAt` vs server before push) for folders/decks/cards only.

### Stats audit fixes (10 findings)
New `toLocalDateStr()` (local-calendar-day key) replaces `toISOString().slice(0,10)` everywhere day-bucketing happens — the old code silently anchored streaks/heatmap/forecast/**daily new-card cap** to UTC midnight instead of local. Streak no longer zeroes just because today hasn't been studied yet. `reviewCard` now persists real `responseMs` (was hardcoded 0, breaking Avg Response Time and the burnout load estimate). FSRS mastery now read live via `fsrsRetrievability` instead of a frozen t≈0 snapshot. Dashboard "Cards Reviewed" deduped by cardId. Standardized retention/accuracy pass threshold to `rating >= 2` (matching the scheduler's own lapse definition) in 5 places — in-session UX counters deliberately left on `rating >= 3`. Review Forecast now cross-references `cards`/`decks` (excludes archived/orphaned). FSRS-only charts (Calibration, R-at-Lapse) now gated on `algorithm==='fsrs'`.

### Complete SM-2 removal
FSRS-5 is now the only algorithm; `srs_data` table/column/type fully removed app-wide (30 files touched). `ReviewLog.ease` deliberately kept — it's stored FSRS difficulty via the SM2-era column name. `src/hooks/useSync.ts` gained `stripLegacySm2State()` to purge stray persisted SM-2 state on rehydrate. Legacy import/export paths convert old `srsData` → `fsrsData` via new `legacySrsToFsrs()` rather than dropping them. New manual migration: `migration-drop-sm2.sql` (drops `srs_data` table + trigger, drops `user_settings.algorithm` column) — must be run manually in Supabase SQL Editor.

### Review-stats wasNew audit + Total Cards Learned
"Reviews" stats now consistently mean repeat reviews only (`wasNew===false`); a `wasNew:true` log is first exposure, not a review. Daily-volume trackers (StudyHub goals, session progress bar) relabeled "studied" (still count everything, by design). Added "Total cards learned" = cards with `fsrsData.state !== 'new'`. Fixed `handleRate`'s session log never setting `wasNew` (silently broke resumed-session new-card counting). Study-time stats confirmed to be session-duration sums, not responseMs sums (report only, no change).

### Visual redesign — Warm Obsidian (Stitch source)
Styling-only pass (colors/type/radii retokened); no logic/data/business changes. Every Stitch-invented feature was audit-flagged and excluded. Correction to two audit assumptions: notes DO route through trash with a real 14-day auto-purge (`TRASH_TTL_DAYS`) — kept existing copy, not Stitch's 30-day claim.

### Fix: `pendingDeletes.sessions is not iterable` crash in deleteDeck/deleteFolder
Persisted state predating the `sessions`/`reviewLogs` buckets rehydrated without them (zustand shallow merge), crashing on spread. Fixed via a custom persist `merge` normalizing to the full five-bucket shape, plus `?? []` guards at the two crash sites and in `migrateLegacyIds.ts`. Reproduced live via Playwright before/after.

### Visual redesign, pass 2 — full structural match to Stitch
Extended pass 1's token-only retheme to layout density/type scale/radii/elevation/component proportions across every screen (dashboard, library, study session, stats, notes, etc.). Styling-only, one audit-approved exception (existing due-count surfaced as welcome sub-line). Verified via Playwright against `next start` — noted for future runs: hard-navigating to `/study/session` races IndexedDB rehydration; use client-side nav instead.

### Fix: "Supabase not configured" warn (env restore) + notes sync gaps
Root cause of the warn: **no `.env.local` existed in the repo at all** — it was sitting one directory up as `.env.local.bak`, left behind by an earlier "move aside for local Playwright run" step that never restored it. Every push/pull had been silently no-oping since. Restored the file (verified credentials live first via health/REST checks). Separately fixed three notes-sync gaps in `useSync.ts`: missing mount-time seed push (untouched notes never reached the server), no dirty tracking (`lastPushedNotes` added, matching other tables), no CAS stale-overwrite guard (extended `dropStaleOverwrites` to notes).

### Fix: CAS-guard resurrection, stale reload watermark, dead realtime DELETEs, fsrs_data pull data-loss
Three compounding deletion-resurrection bugs in `useSync.ts`: (1) `dropStaleOverwrites` treated any row with no server copy as safe to push, including one deleted elsewhere — fixed via a `knownSyncedIds` map check. (2) Module-level `lastPushedX` maps reset on reload, defeating that fix — added `fullPullDoneThisLoad` flag forcing the first pull of every load to be full. (3) Realtime DELETE events were **never delivered at all**: server-side `filter: user_id=eq.…` can't match a DELETE payload (PK-only under default REPLICA IDENTITY), and `schema.sql` never registered any table with `supabase_realtime` publication in the first place — fixed both (client-side ownership checks + new `migration-add-realtime-publication.sql`, must be run manually). Separately, **`fsrs_data` pull merge was unconditional server-wins** — any push-failure window permanently reverted local review progress. Fixed via `pickFresherFsrs(local, server)` comparing a new `FSRSState.updatedAt` stamp (ties/no-local go to server; no-`updatedAt` legacy rows go to server once, then self-heal).

### Fix: `useKeyboard` crash — `Cannot read properties of undefined (reading 'toLowerCase')`
`e.key` can be undefined on some real-world keydown events (IME, some Android keyboards); two unguarded `.toLowerCase()` call sites (`useKeyboard.ts`, `ThemeProvider.tsx`'s vim-jump handler) now early-return on `!e.key`, plus nullable-target guards.

### Fix: `pushExamsToSupabase` error — missing `exams.predicted_retention_at_exam` column
Same class of bug as the realtime-publication gap: a migration written into `schema.sql` (`rating`, `predicted_retention_at_exam` columns) but never actually run against the live DB. Both are real, actively-used fields (`rateExam`, PlannerPage's "Predicted N%" card). No app code was wrong. New manual migration `migration-add-exam-rating-columns.sql`.

### Fix: fsrs_data integrity — 702 server-side orphans (cleanup migration) + cards restored without fsrs rows (backfill)
**Bug 1:** all current delete paths clean `fsrs_data` correctly going forward, but rows orphaned before those fixes were never retroactively cleaned (client-side pull-time pruning never queued a server delete) — 702 of 1000 fsrs rows orphaned. New `migration-cleanup-orphaned-fsrs.sql` (preview count + delete), no FK added (would race the parallel cards/fsrs push). **Bug 2:** four restore paths (trash card/deck restore, `deleteUndo.ts`, JSON import) silently skipped creating an fsrs entry when no snapshot existed — 8 live cards affected, treated as "new" everywhere. Fixed via new `fsrsBackfillCard()` (unstamped, so it can never beat real data), wired into all four restore paths plus `runPull`'s merge (heals existing gaps); backfill pushes use `ignoreDuplicates: true` so a placeholder can't clobber a real server row.

### Fix: review_logs/review_sessions integrity — real sessionId, single-card-delete pruning, cross-device log resurrection
**Bug 1:** every log got a random `sessionId` (not the real session's id), making Session Fatigue stats meaningless — `reviewCard` now accepts and threads the real session id. **Bug 2:** single-card deletes (`deleteCard`/`deleteCardsBatch`) never called `pruneHistory`, orphaning logs — now they do, queuing into `pendingDeletes.reviewLogs`. **Bug 3:** the reviewLogs pull merge omitted the `preExistingIds` argument to `mergeKeepLocal`, so a log deleted on another device resurrected on this device's next full pull — fixed to branch like every other table (full pull uses the pre-existing set; incremental pull correctly does not, since it only returns logs since the watermark). `mergeKeepLocal`'s pre-existing-set param is now required everywhere to prevent regression.

### ⚠️ Accepted data loss: 25 cards reset to `state='new'` — no reconstruction (decision, not oversight)
25 cards lost FSRS history server-side to the (now-fixed) unconditional-server-wins `fsrs_data` merge bug, predating `pickFresherFsrs`. **Deliberately not reconstructed** — decision made to accept the loss (cards just re-enter New and re-learn normally) rather than risk a bespoke recovery script in the sync-critical path. Raw material (`review_logs`) still exists if ever revisited via replay through `fsrsSchedule`; nothing depends on this.

### Fix: correctly-rated new cards "never left the queue" — same-day graduation rule removed
Root cause: `reviewCard`'s same-day graduation override set a correctly-rated new card's `dueDate = now`, so it became due that same instant and reappeared everywhere instantly ("stays in the list, relabeled review"). Removed the override — graduated cards now get FSRS's real first interval (Good≈4d, Easy≈16d) and only reappear when actually due. 3 already-graduated `learning` cards with the override's fingerprint (`due_date === last_reviewed_at`) deliberately left un-migrated (self-heal on next real review) — same rationale as the 25-card decision above. **Note: this rule was later restored** (see "Fix: restore same-day graduation…" below) once the intended UX was clarified as the opposite.

### Investigation: "20 new cards rated Remembered don't show in Reviews after raising newCardsPerDay mid-session" — no bug found
Confirmed **expected behavior, not a bug**: the binary "Remembered" button only sends grade 4 (Easy), whose FSRS-5 default weight (`w[3]=15.4722`) schedules a new card's first interval ~15-16 days out (pre-fuzz) — same-day graduation had been removed in the prior session. Server-side evidence from 7 comparable cards confirmed the pattern; the literal 20 cards hadn't synced to Supabase yet at investigation time (10hr sync gap noted, unrelated to the bug report). Midnight-bucketing and stale-cap-on-limit-change hypotheses both explicitly ruled out with code evidence. **UX flag raised:** "Remembered" silently means grade 4/Easy with no visible signal of the ~2-week jump; a grade-3 remap was flagged as a future fix (later applied — see below).

### Follow-up investigation: same symptom recurs next day, one specific card checked — confirmed same known cause, no second bug
Card `461bb11b…` (evaporation): `due_date − reviewed_at` = 13.0 days exactly (16-day base minus deterministic per-card fuzz) — matches the grade-4/Easy pattern from the prior investigation exactly, confirmed via `fsrsSchedule`'s live math. All alternative explanations (duplicate writes, silent log-write failure, cap miscalculation, stale prior state, midnight bucketing, sync lag) individually ruled out against this card's ground-truth rows. Now confirmed on 2 consecutive days, 3 cards, same mechanism. No fix applied (investigation only) — the grade-3 remap fix was still pending at this point.

### Fix: restore same-day graduation + remap binary "Remembered" from grade 4 to grade 3
Two connected, deliberate fixes implementing the *intended* lifecycle (new card → Remembered → graduates + due today → reviewed again → grade 3/Good → ~4-day real interval). **Fix 1:** restored the same-day graduation override (previously removed — see above), gated on `wasNew && rating>=3`, now using local start-of-day (`setHours(0,0,0,0)`, matching codebase convention) rather than `Date.now()`, so it doesn't vary within a calendar day. **Fix 2:** binary "Remembered" changed from grade 4 (Easy) to grade 3 (Good) at all 4 call sites in `session/page.tsx` — the FSRS community's standard mapping for a collapsed two-button UI. Confirmed via grep: no stats/counter branches on `rating===4` specifically (all use `>=3`), so this required no other logic changes; the "More ⋯" panel's explicit Easy(4) option is untouched. **⚠️ Semantic discontinuity:** `review_logs.rating` before this fix used binary Missed(1)/Easy(4) (265 of 281 historical rows = grade 4); after this fix it uses Missed(1)/Good(3). Historical rows deliberately NOT retroactively changed — going-forward only. Full end-to-end lifecycle trace confirmed via code read (not live-executed).

### Five quick to-do items: schema.sql PK fix, review_sessions noise cleanup, dead-code removal, unused index drop, schema-drift documentation
1. **schema.sql PK fix** — corrected `user_settings` to declare `id` as PK / `user_id` as unique+FK (matches live DB; no live change needed). 2. **review_sessions noise** — live count was 100 (not the expected 96), explained as old offline-synced-late rows predating the earlier StrictMode fix (already present in the working tree, no new code needed this session); deleted all 100 zero-review rows, confirmed 0 remain. 3. **Dead-code removal** — removed `Card.imageUrl`, `ReviewSession.folderId`, always-empty `linkedCardIds`/`prerequisiteCardIds`/`linkedNoteIds`/`embeddedCardIds` (type/initializer level only — DB columns deliberately left untouched), and type-only `Goal`/`StudyStreak`/`DailyStats`. **`CardType`'s `cloze`/`image`/`typed` were flagged but explicitly NOT removed** — user chose to keep them; confirmed unused in live data (305/305 cards are 'basic') but backed by substantial working UI (CardEditor, ReviewCard, import auto-detection), so removal would have meant ripping out functional code, not dead-code cleanup. 4. **Dropped `fsrs_data_due_idx`** (live name differed from schema.sql's `idx_fsrs_data_due_date`) — confirmed no server-side due_date filtering anywhere. 5. **Schema-drift documentation** — added legacy/unused column comments to schema.sql for `fsrs_data.elapsed_days`/`scheduled_days`, `exams.daily_new_card_limit`/`auto_adjust_limits`/`topics`, `user_settings.settings`/`show_deck_name` (no live DB changes).

### Urgent audit: exams push `notes: null` NOT-NULL violation — blast-radius check on the dead-code-removal session
**Root cause (not what the prompt assumed):** no code path ever sets `Exam.notes`, so a fresh local exam carries no `notes` key at all — but `pushExamsToSupabase` upserts the whole `exams` array as **one PostgREST batch**, and PostgREST derives its column list from the *union of keys across the batch*. Since the one live/pulled exam *does* carry a `notes` key, a batch mixing it with a keyless new exam causes PostgREST to send explicit `NULL` for the new exam's missing key, tripping the NOT NULL constraint — the same heterogeneous-batch-key failure class already guarded against for `cards` (`hint ?? ''` etc.), just not yet applied to exams. **Fix applied (only change made):** `notes: e.notes ?? ''` added to the exam upsert payload. Full payload audit (steps 2-3) found no other gaps — all other fields are either always-present or safely nullable/defaulted; dead-code removal from the prior session was confirmed NOT the source (the DB columns it left untouched are uniformly absent across every batch, so no heterogeneity risk exists there). **Step 4 flagged one similar risk, not fixed:** `review_logs.was_new` (NOT NULL DEFAULT false) is optional in the TS type; a batch mixing a pre-`wasNew`-era log with a new one could theoretically trip the same mechanism — all 281 current live rows have it set, so no evidence it's actually fired, but the structural risk is unaddressed.

### Fix: per-deck "New"/"Due" badges showed the global newCardsPerDay cap (20) on every deck instead of real per-deck counts
Bug report: every deck in Library view and the StudyHub inbox list showed "20 New"/"20 Due" — the display was calling `getDueCards`/`getNewCards`, which apply the global `newCardsPerDay` cap and daily-review-limit/exam-pull-forward gating meant only for building the study queue. **Investigation:** confirmed LibraryBrowser (grid + tree-table) used `getDueCards(id).length`/`getNewCards(id).length`, StudyHub `deckData` used `getNewCards`/`getReviewsDue` per deck. **Fix (display-only):** added two uncapped store selectors — `getDeckNewCount` (cards with state `'new'`/no fsrs, unarchived) and `getDeckDueCount` (`toLocalDateStr(dueDate) <= today` && state != `'new'`, no exam pull-forward). Wired into both LibraryBrowser badges/tree-table and StudyHub per-deck list; StudyHub's global inbox counts (`allNewCards`/`allReviews`/`inboxTotal`) deliberately left capped (they represent the real queue). `getNewCards`/`getDueCards`/`getReviewsDue` and all queue-building untouched. Removed now-dead `reviewLogs`/`newCardsPerDay`/`useSettingsStore` refs in LibraryBrowser. `tsc --noEmit` + `next build` both clean.

### Fix: new deck created from inside a folder view landed at root instead of in the folder
Bug report: creating a deck while browsing inside a folder (e.g. Root > Biology > Unit 2 > AOS 1) created it at root, not in the folder. **Investigation:** folder context flowed correctly end-to-end — LibraryBrowser's `onFolderChange` updates the page's `currentFolderId`, all three entry points (header button, empty-state, dashed tile) pass it into `openDeckDialog` → `CreateDeckDialog`'s `defaultFolderId` prop, and `createDeck` honors `folderId`. **Root cause:** `CreateDeckDialog` stays mounted while closed (Dialog only null-renders its children), so its `useState(defaultFolderId ?? null)` for `folderId` captured only the initial-page-mount value (root/null) and never resynced when the prop later changed — the dialog even displayed "Creating a deck inside …" while submitting `null`. **Fix (one file):** added a `useEffect` resetting `folderId` to `defaultFolderId` whenever the dialog opens. `tsc --noEmit` + `next build` both clean.

### Investigation + fix: delete a new card → undo → learn → "reappears in New Cards labeled review"
Audited 4 suspects before touching code. **Suspects 1, 3, 4 RULED OUT** with file/line evidence + two reproductions (pure-local reducers, then a full sync sim with `pickFresherFsrs`/push-pull/in-flight-race): a genuinely never-reviewed card, through delete→undo→learn, correctly graduates (`state=learning`, due today via same-day graduation), leaves `getNewCards`, and becomes a due review — in **every** local and sync ordering; state never reverts to `new` (restore writes the snapshot verbatim with its old `updatedAt`, so `reviewCard`'s fresh stamp always wins). Every new/review classification uses FSRS state, not log presence — no badge-vs-queue gap. **The literal "stuck in New" symptom is not reproducible.** **Suspect 2 CONFIRMED** as the one real defect in the flow: `deleteCard`/`deleteCardsBatch` prune the card's review logs (removed locally + queued in `pendingDeletes.reviewLogs` for server delete), and no restore path reversed this — so undoing a delete of a card *with* history silently lost it (corrupting `getNewCards.studiedNewToday` daily-cap accounting + stats), permanently once the delete push ran. **Fix:** trash entry now stores `cardLogs`; both card-restore paths (`deleteUndo.restoreCardsFromTrash`, trash-page restore) re-add them via new `useHistoryStore.restoreReviewLogs` and drop their ids from `pendingDeletes.reviewLogs`. Card-level delete never prunes sessions (empty deck set), so only reviewLogs needed handling. `tsc --noEmit` + `next build` clean.

### Fix: New Deck modal didn't pre-select current folder + per-deck New/Due badges still capped (DailyQueue)
Two bugs reported still-present with screenshots. **Bug 1 root cause:** `CreateDeckDialog`'s useEffect already set `folderId` correctly, but `FolderTreePicker` inits `expanded` empty and never expands the selected folder's ancestor chain — a deeply-nested pre-selection (Root>Biology>Unit 2>AOS 2) stayed hidden inside collapsed branches, so "No folder" looked unchanged. **Fix:** added a useEffect in FolderTreePicker unioning the selected value's ancestor ids into `expanded` (never collapses manual opens). **Bug 2 root cause (why prior fix "didn't take"):** StudyHub + LibraryBrowser were already migrated to `getDeckNewCount`/`getDeckDueCount`, but `DailyQueue.tsx` (dashboard "Due now" list — the actual screenshotted component) was missed and still called `getNewCards(deck.id)`/`getReviewsDue(deck.id)`, which cap at `newCardsPerDay − studiedNewToday` → the ~20 constants (19/18/18/14/16). **Fix:** DailyQueue per-deck badges now use `getDeckNewCount`/`getDeckDueCount` (uncapped); header totals stay on the capped queries (real inbox). DeckView shows only per-card Due badges (already independent) — no aggregate to fix. `tsc --noEmit` + `next build` clean.

### Investigation + follow-up fix: "5 cards due today per fsrs_data don't show in Reviews" — behavior was correct-but-unwanted, switched to calendar-day due comparison
Prompt (verbatim, condensed): 5 cards in `learning`/`relearning` state with today's-date `due_date` weren't appearing in the Reviews list; asked to check state filtering, a separate learning-steps queue, `toLocalDateStr` date-boundary bugs, and orphaned rows before fixing. **Root cause: none of the 4 — `getReviewsDue` (`useLibraryStore.ts:666`) used an exact-timestamp compare (`new Date(fs.dueDate) <= now`)**, so cards due later the same local calendar day (confirmed via live server `now()` vs. `due_date`, ~15–25h out) correctly didn't show yet — timezone-agnostic and consistent with the raw instant, just inconsistent with the day-granularity `getDeckDueCount` badges elsewhere. No orphans, no archived decks/folders, no separate queue. **User asked to switch to calendar-day granularity.** Fix: `getReviewsDue` now uses `toLocalDateStr(dueDate) <= toLocalDateStr(now)`, matching `getDeckDueCount`'s convention — a card due later today now shows immediately rather than at its exact minute. Kept consistent in two related call sites: `examScheduler.ts`'s `getPulledForwardCardIds` "already due — regular queue handles it" exclusion (was exact-timestamp, would've double-counted pull-forward load for same-day cards), and `DeckView.tsx`'s per-card Due badge (the literal "folder view" from the bug report, previously exact-timestamp same as the old Reviews check). `tsc --noEmit` + `next build` both clean.

### Scheduler migration: custom "FSRS-5" replaced by official ts-fsrs 5.4.1 (FSRS-6)
Prompt (verbatim, condensed): replace the hand-written `src/lib/srs.ts` mathematics with the official Open Spaced Repetition `ts-fsrs` library as the single source of truth (FSRS-6, 21 params, official defaults/fuzz/learning-steps, no home-grown optimizer); keep the two-button UX; preserve review history; audit first, then verify with tsc/lint/build/tests. **`srs.ts` is now a thin adapter** (`FSRSState` ⇄ ts-fsrs `Card`, `fsrsReview`/`fsrsRetrievability`/`fsrsParameters`); `fsrsSchedule`, `withFuzz`, `optimizeFsrsWeights` and the duplicated forgetting curves in `examScheduler.ts`/`StatsPage.tsx` are gone, and the Nemos same-day-graduation override was **deleted** because FSRS-6's own learning steps (`1m,10m`) already keep a just-answered new card due today. **Two-button mapping: Forgot → `Rating.Again` (1), Remembered → `Rating.Good` (3)** — never Easy. **Migration** (`src/lib/fsrsMigration.ts`, one-time, per-row `schedulerVersion` stamp): old S/D are not FSRS-6 values, so reviewed cards are *reconstructed by replaying their real `review_logs` through the official scheduler* — live data split 110 replayed / 288 re-created as new / **0 unrecoverable**; ratings replay verbatim (no rewriting), so 42/110 cards carry the old Remembered→Easy grade-4 distortion and normalise as new grade-3 reviews land. New DB columns `learning_steps`/`scheduler_version` (+ `scheduled_days` now genuinely used) — `migration-fsrs6.sql`, **already applied**. Also fixed a **pre-existing latent race**: `await persist.rehydrate()` resolves while `hasHydrated()` is still false, so the migration (and `migrateLegacyIds`/`migrateHistoryToOwnStore`) could read an empty `reviewLogs` — new `ensureHydrated()` plus a `FsrsMigrationUnsafeError` bail-out prevent a mass reset. 52 unit tests (differential vs. a bare `fsrs()` instance) + 30 live browser assertions all pass; tsc/build clean, lint at baseline.

### Fix: `createBrowserClient` "project's URL and API key are required" on login/signup — stale Turbopack dev cache
Prompt (verbatim, condensed): runtime `@supabase/ssr` error from a login/signup submit (`src_03-bs0k._.js`) despite a structurally-correct `.env.local`; asked to check hidden characters/encoding as raw bytes, conflicting `.env*` files and Next precedence, key truncation, the var names used in `client.ts` vs the file, dev-server restart, and whether it's a Turbopack/Next 16.2.6 env-loading quirk — report root cause before fixing, verify with tsc/build, leave unstaged.
**Root cause: none of the six — the env file and all code were correct** (`.env.local` byte-clean: no BOM, LF-only, zero non-ASCII, sole `.env*` in the project; URL 40 chars, anon key full 208-char JWT; `client.ts:14-15` var names correct; no shell/registry override; `@next/env`'s own `loadEnvConfig` resolved both fine). The failing chunk had `("TURBOPACK compile-time value", "")` — **empty strings, not `undefined`** — inlined at `createBrowserClient`, and its `.js.map` was 15 days staler than its `.js`, proving a cache restore rather than a recompile: `.next/dev/cache/turbopack` (2.3 GB, dated 31/05) predated the 11/07 `.env.local` restore and was never invalidated, so every `next dev` since — including restarts — replayed the July-11 compile of `client.ts`. The parallel prod build was unaffected (`.next/static` had the real URL), confirming the env pipeline itself was healthy and that **restarting the dev server alone could never have fixed it**.
**Fix: deleted `.next/` (2.57 GB) and restarted dev — no code change.** Recompiled `src_03-bs0k._.js` now inlines the real URL + key. `tsc --noEmit` and `next build` both exit 0. Note: a `next start` (:3000) and `next dev` (:3100) were running concurrently off the same `.next/`; both were stopped for the rebuild and only dev was restarted.

### Seven-item pass: 1000-row PostgREST cap (root cause of 4 of the 7 reports), same-day schedule lock, drill-mode write gating, settings toggle
Prompt (verbatim, condensed): (7, first) search the whole codebase for a hardcoded ~1000-card limit — `.limit()` without pagination, array slicing, `select()` missing `.range()`, a `MAX_CARDS` constant — check every place cards/fsrs_data/review_logs are pulled from Supabase for a default or implicit row limit; report explicitly whether one was found, and if so replace it with proper pagination so no ceiling exists. (1) Lock a card's review status for the rest of the day once rated — no other mechanism may re-rate or reschedule it except the existing Undo; report every path found first. (2) Bulk import silently truncates 203 cards to partial imports of 82/170 — find whether it's one giant insert, sequential inserts, an unawaited loop or a rate limit, then fix with chunked batched inserts, per-batch error reporting and a progress indicator. (3) Retention rate isn't persisted/synced — without changing sync architecture or adding synced fields, compute it live from already-synced review_logs (per day: `rating >= 2` over non-`wasNew` logs). (4) Review status may only be modified from the Reviews folder — "Study Weakest" and the session-end "review missed cards" pass must not write fsrs_data/review_logs (new cards' first exposure excepted); audit every entry point into `reviewCard()` and report violations. (5) FSRS interval progression bug — a card graduates, is rated correctly, and returns to Reviews the very next day instead of compounding; trace a real card through ts-fsrs standalone and report root cause with evidence before fixing. (6) Settings button opens the popup but doesn't close it — only a reload dismisses it. Report root cause with file/line evidence per item, verify with `tsc --noEmit` + `next build`, leave unstaged.

**7 — FOUND, and it is the root cause of items 2, 3 and 5.** No `.limit()`/`.range()`/`MAX_CARDS` exists anywhere in `src`; the cap is **PostgREST's server-side `db-max-rows`**, which injects `LIMIT $n` into every SELECT. Proved empirically (scratch table, 3000 rows, anon REST): `Content-Range: 0-999/3000`, and `?limit=2500` returns the same 1000 — a hard cap, applied silently (200 OK, no error). Live data is past it: **1216 cards, 1216 fsrs_data, 2545 review_logs**. Because a full pull feeds `mergeKeepLocal`, which drops any *pre-existing* local row absent from the "complete" server set, every fresh load was **deleting ~216 cards and ~1545 review logs locally**, and `fsrsBackfillCard` then reset orphaned cards to `state:'new'`. Server-side fingerprints confirm it: **10 cards in `state:'new'` with `last_reviewed_at IS NULL` despite having review_logs, and 52 cards with `repetitions` < their own log count**. Fix: new `fetchAllRows()` helper in `useSync.ts` pages every list read with `.range()` + `{count:'exact'}` + a deterministic `.order()` (PK), advancing by rows actually returned and ending only on an empty page or the exact count — so it cannot truncate whatever the server cap is. All 8 list tables in `runPull` converted; `user_settings` (single row) left alone. `.in()` call sites already chunk at 100.

**2 — the import was never broken.** `importCards` (`useLibraryStore.ts:331`) builds all cards + FSRS rows in memory and commits them in **one synchronous `set()`**; the push already batches at 100/request and throws with the failing batch index. Server proof: deck "RUSSIAN REVOLUTION" holds **all 203 cards**, one identical `created_at`. The user only ever *saw* 82/170 because the next full pull truncated at 1000 and `mergeKeepLocal` deleted the difference. Crossing 1000 total cards is exactly when this began. Fixed by item 7; no import-path change made (adding batching where inserts are already atomic and batched would be churn).

**3 — already implemented exactly as specified; nothing was missing.** All three retention computations (`StatsPage.tsx:199`, `PeriodStats.tsx:37`, `StatsOverview.tsx:41`) are already derived live from synced `review_logs`, already exclude `wasNew`, already use the `rating >= 2` threshold, and already bucket by local day via `toLocalDateStr`. No persisted state, no new fields. It "didn't persist" because the review_logs themselves were being deleted locally by the truncated pull (server kept all 2545 — `mergeKeepLocal` drops rows without queuing a delete). Fixed by item 7; **no code change**.

**5 — not a scheduler bug; same root cause.** Traced standalone `ts-fsrs` (steps `1m,10m`, fuzz off): Good→Good→Good→Good yields 0.007d → 2d → 7d → 23d, and across a day boundary 0.007d → 7d → 23d — compounding correctly. Live data agrees: review-state cards average `scheduled_days` 25.9, with exactly one card at 1 day. So no reset happens *between* reviews; the card returning is a card whose fsrs row was destroyed by the truncated pull and re-created as new. Note the intended progression is FSRS-6's 2d→7d→23d, not "1 day → 3 days". Hardened as defence-in-depth: `runPull`'s backfill now **reconstructs from real `review_logs` via `replayCardHistory`** instead of stamping `state:'new'` on a card that has history (result left unstamped so any real row still wins).

**1 — every path audited; guarded the silent ones.** `reviewCard` has exactly **one** call site (`session/page.tsx:635`). Other writers: `setFSRSData` (undo only, already recency-checked against `postReviewUpdatedAt`), `resetCardSRS` (explicit user action), trash/undo restore, the one-time `migrateFsrsToV6`, `pickFresherFsrs` (legitimate cross-device sync), and `runPull`'s backfill. The one genuinely *silent* rescheduler was the backfill — it now refuses any card with a review logged today, and reconstructs rather than resets otherwise. **Deliberately not implemented: a literal "no schedule write at all today" lock.** FSRS-6's learning steps are sub-day by design (rate at 1m, rate again at 10m → graduate), so a strict same-day lock would break new-card graduation — and item 5's own premise ("graduates into Reviews same-day … rate it correctly in Reviews") depends on the second same-day rating landing. The lock is therefore scoped to background/automatic mechanisms, which is what was actually leaking.

**4 — two violations found, both fixed.** Both ran through the same ungated `handleRate`. (a) The session-end **missed-cards pass** (`sessionPhase === 'retry'`) called `reviewCard()` and logged — re-grading cards answered minutes earlier and overwriting the first pass's real schedule. (b) **Planner "Study Weakest"** (`?mode=weakest`) did the same for cards already in review/relearning. `handleRate` now computes `drillOnly` and, when set, advances the queue and updates in-session counters only — no `reviewCard()`, no `addLog`, no undo entry. Weakest still permits a **new** card's first exposure, per the rule. Plain `?mode=cram` is deliberately untouched: it is reached from StudyHub/inbox/reviews, i.e. inside the Reviews area, not from the Planner.

**6 — confirmed state bug.** Both settings buttons (`Sidebar.tsx:171` collapsed, `:336` expanded) were `onClick={() => setSettingsOpen(true)}` — always `true`, never a toggle — and the panel's backdrop starts at `left: var(--sidebar-width)`, so the button stays exposed and a second tap was a no-op. Both now `setSettingsOpen((v) => !v)`. Escape and backdrop-click handlers already existed and were left as-is.

**⚠️ Pre-existing data damage left alone (reported, not repaired):** the 10 reset-to-new cards and 52 with understated `repetitions` still carry the old damage — they have an fsrs row, so the new replay-backfill skips them. Same rationale as the earlier accepted 25-card loss: they re-learn normally, and `review_logs` still holds the raw material if a replay is ever wanted. Also noted: `migrateFsrsToV6` guards only against a *totally empty* log set, so the FSRS-6 migration may itself have replayed truncated histories — the likely source of the 52.

Files touched: `src/hooks/useSync.ts` (paginated every pull read; replay-based, same-day-safe fsrs backfill), `src/app/(app)/study/session/page.tsx` (drill-only gating for retry pass + exam "Study Weakest"), `src/components/layout/Sidebar.tsx` (settings button toggles). `tsc --noEmit` clean, 52/52 tests pass, `next build` clean.

### Nine-item pass: active-time study tracking, answered-today due rule, folder move-to-root, sidebar/library/chart tweaks, full FSRS write-site audit
Prompt (verbatim, condensed): (1) Remove the standalone "DECKS" section (deck list + "+ New Deck") from the persistent sidebar entirely; confirm nothing depends on it and flag rather than silently break. (2) Stats retention graph draws a gap/false zero on missed days — make it draw straight through to the next real point using the charting library's own connect-nulls option, not fabricated data points. (3) Default Library deck sort → date created, newest first, without overriding a user's explicitly chosen sort if one is saved. (4) Folders lack the move-to-root mechanism decks have — investigate how decks do it and apply the same UI pattern to folders. (5) Full refix of study time: cap a single card's contribution at 60s; count only while the tab is visible and the window focused (Page Visibility API + focus/blur), stopping immediately on background/minimise/blur; apply to per-card responseMs and to total session/study-time aggregation; cap the existing responseMs consumers (avg response time, burnout pace) too. (6) Re-investigate "same card two days in a row" — do NOT reuse the prior truncated-pull conclusion; pick a live card, pull its full fsrs_data + review_logs via MCP, run the identical inputs through ts-fsrs standalone and compare against what was actually written; also check whether it is really item 7 (correct due_date, miscounted/redisplayed) and report which is happening. (7) Reviews counter only decrements on correct answers — a wrong answer should still decrement it (the card was reviewed; it just returns sooner). (8) Re-verify the missed-cards retry gating end to end: zero writes to fsrs_data, review_logs, or any store field feeding scheduling — including local UI state that later syncs; report the full trace. (9) Exhaustive sweep of every FSRS write site — all reviewCard() call sites, direct fsrsData/fsrs_data writes, all Planner/exam study features, quick-study/cram/practice/preview, card editor side effects, import/restore overwrite paths, keyboard/quick actions, bulk operations, undo/redo; report the complete list before gating, then fix every violation. Report root cause with file/line evidence per item, verify with `tsc --noEmit` + `next build`, leave unstaged.

**6 — NOT the prior conclusion, and not a scheduler bug: the written due_dates are exactly right.** Replayed two live cards' complete `review_logs` through a bare `ts-fsrs` instance and compared field-by-field against `fsrs_data`. Card `8e942232` (2 logs): replay gives S=7.3153 D=2.1112 state=review reps=2 — stored row is **identical**, `scheduled_days` differing only by official fuzz (3 vs 2). Card `552a6b12` (4 logs, last=Again): replay gives S=1.4294 D=7.3900 state=relearning due=+10m — stored row matches **exactly, including due_date**. Two real causes, neither a defect: (a) `user_settings.target_retention` is **0.95**, not the 0.9 default — at R=0.95 a card with S=7.32 earns ~3 days where R=0.90 would give 7, so short intervals are the requested retention working as configured (`fsrs_weights` checked too: byte-identical to ts-fsrs 5.4.1 `default_w`). (b) A card rated Missed enters relearning on FSRS-6's `10m` step, i.e. due the same calendar day — and stays due every day after until answered correctly. **So the answer to the "or is it item 7?" question is: it is item 7.** The schedule is correct; the queue was redisplaying it.

**7 — confirmed, root cause found, fixed.** `getReviewsDue` (`useLibraryStore.ts:666`) and `getDeckDueCount` both asked only `toLocalDateStr(dueDate) <= today`, with no "already answered today" test. Answer correctly → due moves out days → counter drops. Answer wrong → relearning re-dues the card ~10 minutes later, **the same local day** → it is instantly counted as due again and the counter never moves. Fix: new shared `answeredToday(fs, todayStr)` helper (checks `fsrsData.lastReviewedAt`), applied in both — and in `getReviewsDue` *before* the exam pull-forward branch, so a pull-forward can't resurrect an answered card either. `getDueCards` composes `getReviewsDue`, so every badge (StudyHub, DailyQueue, Sidebar, inbox/reviews pages, Library) is fixed by the same two edits. **⚠️ Intended behaviour change worth knowing:** answering now clears a card from *today's* queue whatever the grade, so a missed card no longer reappears within the same day (it is still genuinely due tomorrow, which is correct SRS). This also means a card learned today no longer re-enters Reviews the same day — say if you want new cards exempted.

**5 — rewritten, not patched.** Old behaviour: `responseMs = Date.now() - cardShownAtRef` (uncapped, counted backgrounded time) and study time = `endedAt - startedAt` session wall clock in three places. Live damage: mean `responseMs` **100s**, max **69,515,637ms (19.3 hours)**, 197 logs over 60s. New `src/lib/activeTime.ts`: `ActiveTimer` accumulates only while `document.visibilityState === 'visible'` **and** `document.hasFocus()`, driven by `visibilitychange`/`focus`/`blur`/`pagehide`; `CARD_TIME_CAP_MS = 60_000`; `capCardMs`; `activeStudyMs(logs)`. Session page now keeps per-card and per-session timers and writes `cardTimerRef.cappedElapsed()` as `responseMs`. Study-time totals are now **derived from capped `responseMs`** (StatsOverview period, StatsPage month, StudyHub today, session-complete screen) rather than session wall clock — deliberate: it needs no new synced field or DB column, and makes per-card and total time consistent by construction. Consumers capped too: Avg Response Time (`StatsPage.tsx:234`) and the burnout pace projection (`SettingsPage.tsx:59`). **Trade-offs:** inter-card gaps no longer count, and the ~129 legacy logs with `responseMs = 0` contribute nothing, so historical study-time figures drop.

**9 — full sweep; one new violation found and gated.** Every FSRS write site in the codebase: **`reviewCard()` — exactly one call site**, `session/page.tsx:668` (all 8 rating triggers — 2 buttons, 3 keyboard paths, ConfidenceRating, More-ratings panel — funnel through the one gated `handleRate`). **`useLibraryStore`**: `createCard:323` / `importCards:358` (new rows only), `initCardSRS:488` (no-op if present), `setFSRSData:496`, `resetCardSRS:501`, `reviewCard:572`, and `deleteFolder:213`/`deleteDeck:291`/`deleteCard:422`/`deleteCardsBatch:475` (deletions only). **Session page**: `setFSRSData` at :720 (undo — reverts to the pre-review snapshot, writes no new schedule), `resetCardSRS` at :840. **DeckView:548** per-card "Reset progress". **Restore paths**: `trash/page.tsx:198,222`, `deleteUndo.ts:34`, `import.ts:354,378,393`, `restoreBackup.ts` (explicit full-library replace). **Sync**: `pickFresherFsrs` (cross-device merge) and `runPull`'s replay-backfill. **One-time**: `fsrsMigration.ts`. Checked and **clean**: `updateCard`/`updateCardsBatch` never touch `fsrsData`, so the card editor and every bulk multi-select action (move/tag/archive/reorder) cannot change a schedule; the only Planner/exam study entry point in the whole app is `?examId=…&mode=weakest` (already gated); `?mode=cram|random|failed|deck-*` all originate inside the Reviews area. **New violation fixed:** the in-session "Reset review history" option (`handleResetSRS`) was reachable from *any* mode, including Study Weakest and the retry pass — now hidden via a new `isDrillContext` flag and refused by the handler itself.

**8 — full trace, no leaks.** Retry rating path: `handleRate` → stale-card guard → `isNew` read (no write) → new-card requeue branch (in-memory only) → `drillOnly` short-circuit → `setMissedReviewCount`/`setHistory`/`setAnimatingOut` (React `useState`) → `nextCard()` → return. No `reviewCard`, no `addLog`, no `pushUndo`. The queue/index/logs live in **`useStudyStore`, which is a bare `create()` with no `persist` middleware and is not referenced anywhere in `useSync.ts`** — it cannot reach Supabase. The session-recovery snapshot writes to **sessionStorage** only. The one synced write in the flow is `endLibrarySession` → `review_sessions`, computed from `useStudyStore.logs`, which the gate keeps free of retry ratings — so the row reflects the first pass only, correctly. Header "Today" progress reads `useHistoryStore.reviewLogs`, untouched. Historical proof the gate was needed: card `c9a90966` carries three real logs 9 and 7 seconds apart (3 → 1 → 3) from a pre-fix retry pass.

**1 — removed; nothing depended on it.** Deleted the sidebar `{/* Decks tree */}` block and the bottom "New Deck" button, plus the now-dead `expandedFolders`/`toggleFolder`/`rootFolders`/`rootDecks`/`deckCardCount`, the `CreateDeckDialog` mount and three unused icons. The collapsed-sidebar variant never rendered decks. Study-section counts are unaffected (separate `getDueCards`/`getNewCards`/`getReviewsDue` memos). Deck creation remains on Library (header button, empty state, dashed tile) and in CommandPalette; deck navigation remains via Library and CommandPalette.

**2 — one-line fix, library's own option.** `StatsPage.tsx:816` had Recharts `<Line … connectNulls={false} />`, so a no-review day broke the line. Now `connectNulls` — Recharts spans the gap itself; `retentionData` still emits `retention: null` for empty days, so no interpolated points are fabricated and the tooltip still reads "No data".

**3 — safe; no saved preference exists to override.** `LibraryBrowser.tsx:240` is a plain `useState<SortBy>('alpha')` — nothing persists a sort choice anywhere (it already resets on navigation), so there was no user preference to protect. Default is now `'created'`, whose comparator was already newest-first (`new Date(b.createdAt) - new Date(a.createdAt)`). A selection made in the toolbar still wins while the view is mounted. If the choice should be *remembered* across navigation, that's a separate feature — say the word.

**4 — decks use a `FolderTreePicker` dialog with a "Library root" option; folders now do too.** Decks move via the bulk "Move to folder" dialog (`LibraryBrowser.tsx:863`), where `noFolderLabel="Library root"` sets `folderId: null`. Folder menus had only Star/Archive/Delete in **both** renderers (grid/list `folderMenuItems:666`, tree-table `folderMenu:972`). New `MoveFolderDialog.tsx` mirrors the deck dialog exactly — same picker, same "Library root" label, setting `parentId: null` — wired into both menus with a "Move to folder" item. Targets exclude the folder and its whole subtree (`subtreeIds`) so a folder can't be moved inside itself.

Files touched: `src/lib/activeTime.ts` (new — capped, visibility/focus-gated timing), `src/components/library/MoveFolderDialog.tsx` (new — folder move incl. root), `src/store/useLibraryStore.ts` (`answeredToday` rule in `getReviewsDue`/`getDeckDueCount`), `src/app/(app)/study/session/page.tsx` (active timers, capped responseMs, `isDrillContext`, reset-SRS gate), `src/components/layout/Sidebar.tsx` (Decks section removed), `src/components/library/LibraryBrowser.tsx` (default sort `created`, folder Move menu + dialog), `src/components/stats/StatsPage.tsx` (connectNulls, active study time, capped avg response), `src/components/dashboard/StatsOverview.tsx` + `src/components/study/StudyHub.tsx` (active study time), `src/components/settings/SettingsPage.tsx` (capped burnout pace). `tsc --noEmit` clean, 52/52 tests pass, `next build` clean, lint at baseline.

### Fix: same-day graduation regression — `answeredToday` gate swallowed a new card's first exposure

Prompt (verbatim): URGENT REGRESSION: Same-day graduation has been broken by a recent fix and must be restored immediately. This is a hard product requirement, not up for reinterpretation.

HARD RULE, PERMANENT, NON-NEGOTIABLE:
A newly learned card MUST graduate into Reviews the SAME DAY it is first learned. This has been true throughout this entire project and must remain true. Do NOT remove, gate, delay, or otherwise interfere with same-day graduation for any reason, under any fix, ever — unless I explicitly and specifically ask you to change same-day graduation behavior in so many words. A fix for something else (counters, due-date recounting, answeredToday checks, exam pull-forward, anything) is NEVER grounds to touch this. If a fix you're about to make would affect same-day graduation as a side effect, STOP and flag it to me before proceeding instead of just doing it.

What likely broke it: the recent answeredToday() gate (added to fix the reviews counter not decrementing on wrong answers) was placed before the exam pull-forward branch in getReviewsDue/getDeckDueCount, and is confirmed to apply uniformly to all cards including brand-new ones on their first rating (wasNew === true). This is almost certainly now also preventing a newly-graduated card from appearing in Reviews at all today, not just preventing it from being double-counted after being answered once.

Fix required:
1. Find every place answeredToday() (or equivalent) is used to gate due/review counting.
2. Confirm whether it is currently preventing a same-day-graduated card from appearing in Reviews on the day it graduates, at all — not just preventing a re-count after being answered. These are two different things and must be handled separately:
   - Correct: a card graduates today, appears in Reviews today, is answerable today, is visible in the due count today.
   - Also correct: once that card has been answered today, it should not be re-counted as due again later today (this is the fix from last session, keep this part).
   - Wrong (the current bug): the card never appearing in Reviews / never being answerable on its graduation day at all.
3. Fix so same-day graduation is fully restored: a card learned today graduates into Reviews today, is visible and answerable today, gets answered once today, and only then stops re-counting as due for the rest of that day (consistent with the once-per-day-for-everyone rule already established).

Test explicitly before reporting done: learn a brand new card right now, confirm it appears in the Reviews/due list immediately after grading it out of New Cards, confirm it's answerable, confirm the due badge count reflects it correctly both before and after being answered.

Run tsc --noEmit and next build to verify. Do not commit or push — leave changes unstaged for me to review and push myself. List every file touched with a one-line summary.

Append to CLAUDE.md under ## Session Log: this prompt verbatim, root cause, fix summary. Add a permanent, prominent note under the Rules section (not just the session log) stating: "Same-day graduation is a hard, permanent requirement. Never remove, gate, or delay it as a side effect of any other fix. Only change this behavior if explicitly instructed to change same-day graduation specifically." This note must persist across all future sessions.

**Confirmed, and worse than reported.** The diagnosis in the prompt was exactly right. `answeredToday(fs, todayStr)` (`useLibraryStore.ts:116`) tests only `fsrsData[cardId].lastReviewedAt` — and a brand-new card's **first exposure stamps `lastReviewedAt` just like any other rating**, so the gate could not tell "graduated 30 seconds ago" from "already reviewed today". Reproduced live against the real store (node/vitest, nothing about the scheduler mocked): create deck → create card → `reviewCard(id, 3, …)`. Immediately after the first rating:

```
fsrs:  state=learning  due=+10m (today)  lastReviewedAt=now  reps=1
getNewCards      → 0     (correct: it left New)
getReviewsDue    → []    ← WRONG
getDeckDueCount  → 0     ← WRONG
getDueCards      → []    ← WRONG
```

So it was not merely missing from Reviews: with `getDueCards` empty too, a just-learned card **vanished from the entire app** — inbox, Reviews page, session queue and every due badge — until the next calendar day. Exactly the "never appearing / never answerable on its graduation day" case the prompt named as the bug. The `answeredToday` placement before the exam pull-forward branch was correct and is unchanged; the defect was the predicate itself, not its position. Audited for other gates: `answeredToday` has exactly two call sites (`getReviewsDue:676`, `getDeckDueCount:784`), no daily-review-limit gate exists in queue building at all, and `getPulledForwardCardIds` was not involved — so this was the sole cause.

**Fix.** New `graduatedTodayIds(todayStr)` in `useLibraryStore.ts` returns the cards whose **only** answer today was their first exposure — a `wasNew === true` log today with no ordinary log since (built in one O(logs) pass, mirroring `getNewCards`'s existing `wasNewTodayCardIds` scan). Both gates became `answeredToday(fs, todayStr) && !graduatedToday.has(c.id)`. The two rules are now genuinely separate: *answered today* still suppresses, *graduated today* is exempt until actually reviewed. Deliberately **additive, not a replacement** — a log with no `wasNew` key (pre-`wasNew`-era rows) counts as an ordinary review, and a card with no logs at all still falls through to the old suppress behaviour, so missing history can never resurrect a genuinely-reviewed card. `answeredToday` itself is unchanged but now carries a ⚠️ comment forbidding its use as a standalone due gate.

Because these two queries now read `reviewLogs`, `reviewLogs` was added to the `useMemo` dependency arrays at every consuming call site (two of which had to newly subscribe to it). `session/page.tsx`'s `buildQueue` is deliberately untouched — it has an explicit `eslint-disable` and rebuilds only at session start.

**Verified end to end**, not by inspection: new permanent regression suite `src/store/sameDayGraduation.test.ts` drives the real store through the whole lifecycle and asserts the card is in `getReviewsDue(deck)`, `getReviewsDue()`, `getDueCards(deck)` and `getDeckDueCount === 1` on its graduation day, then absent from all four after one review — plus a wrong-answer case (once-per-day rule still holds) and a no-logs review card (still suppressed). `tsc --noEmit` clean, `next build` clean, **55/55 tests pass** (52 pre-existing + 3 new). Left unstaged. One incidental finding, not a bug: a `learning` card rated Again returns to `learning`, not `relearning` — ts-fsrs only uses `relearning` from `review` state.

Files touched:
- `src/store/useLibraryStore.ts` — added `graduatedTodayIds()`; both `answeredToday` gates (`getReviewsDue`, `getDeckDueCount`) now exempt cards that graduated today.
- `src/store/sameDayGraduation.test.ts` — **new**: permanent regression suite locking the same-day graduation lifecycle.
- `CLAUDE.md` — new top-level `# Rules` section with the permanent same-day-graduation invariant, plus this log entry.
- `src/app/(app)/study/reviews/page.tsx` — subscribes to `reviewLogs`; added to the `getReviewsDue` memo deps.
- `src/components/library/LibraryBrowser.tsx` — subscribes to `reviewLogs`; added to the `getDeckDueCount` memo deps.
- `src/app/(app)/study/inbox/page.tsx` — `reviewLogs` added to the `getReviewsDue` memo deps.
- `src/components/study/StudyHub.tsx` — `reviewLogs` added to the `getReviewsDue` and per-deck count memo deps.
- `src/components/dashboard/DailyQueue.tsx` — `reviewLogs` added to the `getReviewsDue` and per-deck badge memo deps.
- `src/components/layout/Sidebar.tsx` — `reviewLogs` added to the `getReviewsDue` memo deps.

### Fix: archived decks — block new-card introduction, keep reviews, add library indicator

Prompt (verbatim): Bug/Feature: Archive behavior on decks needs to be fixed and completed.

INTENDED BEHAVIOR (confirm this doesn't already exist before assuming it's missing):
1. An archived deck gets a visual indicator in the deck list/library — a small red dot or
   distinct color/badge on the deck row — so it's visually obvious it's archived.
2. Cards belonging to an archived deck must be EXCLUDED from the New Cards queue/box
   (getNewCards or equivalent) — no new cards from an archived deck should ever be
   introduced/queued for first-time study.
3. Cards belonging to an archived deck must STILL remain fully active in the review/SRS
   system — i.e. if a card already has review history/scheduling, it keeps showing up in
   Reviews/Due (getReviewsDue, getDeckDueCount) on its normal schedule. Archiving a deck
   must NOT pull its cards out of spaced repetition. Only new-card introduction is blocked.

INVESTIGATE FIRST:
1. Find where "archived" status lives today — field on deck (and/or card) in the store and
   in Supabase (archived: boolean vs archivedAt: timestamp?). Report which.
2. Find every place that currently reads this archived field, and every place that queries
   decks/cards but does NOT check it. Specifically check:
   - New Cards queue (must exclude archived-deck cards — this is likely broken or missing)
   - Reviews/Due queue and per-deck due count (must NOT exclude them — confirm this is
     currently correct; if it's wrongly excluding already-scheduled cards, that's also a bug)
   - Library/deck list view (needs the new visual indicator)
   - Any bulk "all cards"/duplicate-detection/search paths — decide if archived should be
     visible there and say why
3. Check whether archived status is a deck-level flag only, and if so, how "is this card's
   parent deck archived" is currently determined for the New Cards filter (join/lookup vs a
   denormalized flag on the card). Report inconsistencies (e.g. some queries check the deck,
   some check a stale per-card copy of the flag).
4. Report findings with file/line references BEFORE making changes.

FIX:
- Make New Cards queue exclude any card whose deck is archived.
- Ensure Reviews/Due queue explicitly does NOT filter out archived-deck cards (add a test/
  comment making this intentional, since it's the easy thing to get wrong).
- Add the archived indicator (red dot or distinct treatment) to the deck list UI, using
  existing design tokens/components rather than inventing new styling patterns.
- Fix any other query found in step 2 that's inconsistent with the intended behavior above.

VERIFY:
- Run tsc --noEmit and next build, fix any resulting errors.
- Do not commit or push. Leave changes unstaged.
- List every file touched with a one-line summary of what changed.

Append to CLAUDE.md under "## Session Log": this prompt (verbatim), findings, and fix
summary — 3-4 lines max.

**Findings.** `isArchived` is a **boolean** (not `archivedAt`) on Folder/Deck/Card/Note (`types.ts:34,49,68,107`; `schema.sql:23,37,55,145` `is_archived`), and deck-level vs card-level are independent — archiving a deck never touches its cards. Answer to step 3: **neither a join nor a denormalized flag — the lookup simply did not exist.** `getNewCards` (`useLibraryStore.ts:651`) filtered only card-level `!c.isArchived` plus an orphan check against *all* decks, so **archived decks kept feeding new cards into the inbox** (item 2 broken, confirmed). Item 3 was already correct but only by accident — nothing documented it. Item 1 missing: `LibraryBrowser.tsx:303` shows archived decks with no marker at all. Inconsistency worth recording: StudyHub/DailyQueue/Stats/Planner/import/FolderTreePicker all drop archived decks from their *per-deck lists*, while their header totals came from `getNewCards()`/`getDueCards()` which did not — so an archived deck contributed new cards to the inbox total with no row to account for them. Deliberately unchanged: CommandPalette search still finds archived decks (you must be able to find one to unarchive it); duplicate detection (`CardEditor.tsx:72`) is already deck-scoped so archiving cannot affect it; the per-deck Study popup (`getDeckNewAll`) still offers new cards, since that is an explicit act on that one deck, not automatic introduction.

**Fix.** `getNewCards` now builds an `archivedDeckIds` set and excludes those cards; `getReviewsDue` is unchanged but carries a ⚠️ comment stating the non-exclusion is intentional and load-bearing. New `src/store/archivedDeck.test.ts` locks both halves plus the card-level/deck-level distinction. Library deck rows (grid, list, tree-table) gained an `ArchivedDot` marker — the existing `Archive` lucide icon in the existing `var(--danger)` token, placed exactly where the Star marker sits. `tsc --noEmit` clean, `next build` clean, **59/59 tests pass** (55 + 4 new). Left unstaged.

Files touched:
- `src/store/useLibraryStore.ts` — `getNewCards` excludes archived-deck cards; `getReviewsDue` gains a ⚠️ comment that its non-exclusion is intentional.
- `src/store/archivedDeck.test.ts` — **new**: locks "no new cards from archived decks" and "reviews keep running regardless".
- `src/components/library/LibraryBrowser.tsx` — new `ArchivedDot` indicator wired into all three deck renderers.
- `CLAUDE.md` — this log entry.

**Follow-up correction (same session) — archive is INHERITED down the folder tree.** User: *"no the decks within a archived folder are archived. that should only be overriden if or when the user specifically goes and unarchives it"*. The first pass treated deck archive as a deck-level flag only and merely *flagged* folder cascade as an open gap; that was wrong. New `src/lib/archive.ts` (`archivedFolderIds` / `archivedDeckIds`) resolves the full ancestor chain — memoised, with an explicit cycle + orphaned-parent guard so a corrupted tree can't hang the queue — and is now the single source of truth for "is this deck archived". **Deliberately inheritance, not a cascade write:** each item keeps its own `isArchived` flag untouched, so nothing un-archives implicitly and unarchiving a folder restores exactly the items that were archived *by inheritance* while anything the user archived individually stays archived. A cascade write would have destroyed that distinction irreversibly and pushed hundreds of rows to Supabase. Wired through the store (`getArchivedDeckIds`, consumed by `getNewCards`) and every surface that filtered `!d.isArchived` on a flat deck list (StudyHub, DailyQueue, HardestTopics, StatsPage ×3, PlannerPage's unlinked-deck list, the import picker) plus the two folder pickers, where filtering by a folder's own flag alone let a subfolder of an archived folder resurface as a tree root. Library markers now distinguish self-archived from folder-inherited in their tooltip. Reviews remain untouched — an inherited-archived deck keeps reviewing exactly like a directly-archived one, locked by three new tests. **Known behaviour, not a bug:** individually unarchiving a deck that sits inside an archived folder has no visible effect until the folder is unarchived (the folder governs); its own flag still records the intent. `tsc --noEmit` clean, `next build` clean, **65/65 tests pass**, lint unchanged at its 12-error baseline (all pre-existing `set-state-in-effect` / `no-unescaped-entities` in untouched lines — verified by linting the HEAD copies of the same files).

Additional files touched by the follow-up:
- `src/lib/archive.ts` — **new**: inherited-archive resolver (`archivedFolderIds`, `archivedDeckIds`) with cycle/orphan guards.
- `src/store/useLibraryStore.ts` — new `getArchivedDeckIds()` query; `getNewCards` now excludes inherited-archived decks.
- `src/components/library/LibraryBrowser.tsx` — `ArchivedDot` gained a self-vs-inherited tooltip; markers added to folder rows and wired into all five renderers.
- `src/components/study/StudyHub.tsx`, `src/components/dashboard/DailyQueue.tsx`, `src/components/dashboard/HardestTopics.tsx`, `src/components/stats/StatsPage.tsx`, `src/components/planner/PlannerPage.tsx`, `src/app/(app)/import/page.tsx` — flat deck-list filters now use the inherited set (each subscribes `folders`).
- `src/components/library/FolderTreePicker.tsx` — hides the whole subtree of an archived folder, not just the folder itself.
- `src/store/archivedDeck.test.ts` — six more tests: cascade at depth, reviews unaffected, selective restore on unarchive, plus helper unit tests for cycles/orphans/root decks.

### Archive-inheritance UX gap + mobile responsive layout

Prompt (verbatim): This session covers two unrelated fixes. Do both, in order, each with its own investigate-
first / fix / verify cycle. Don't let one bleed into the other's file changes.

======================================================================
PART A — Archive-inheritance follow-up: fix the silent-unarchive UX gap
and independently verify the last session's claims
======================================================================

CONTEXT: Folder-level archive inheritance was just added (src/lib/archive.ts,
getArchivedDeckIds(), getNewCards excludes inherited-archived decks). One behavior was
flagged but left unfixed: individually unarchiving a deck that sits inside an archived
folder flips that deck's own isArchived flag to false in the background, but the deck
still shows as archived (governed by the parent folder) with NO visible feedback that
anything happened. A user clicking "unarchive" on that deck sees no change and will
assume the click didn't register.

FIX:
1. When a deck's own flag is unarchived but it's still effectively archived via an
   ancestor folder, surface that state explicitly in the UI — e.g. the deck row/tooltip
   should say something like "Inherited from archived folder — unarchive the folder to
   restore" instead of looking identical to a plain archived deck or an active deck.
2. Confirm this doesn't require a third state on the deck record — it shouldn't, since
   the deck's own flag already correctly records intent (per the existing design); this
   is a display-layer fix only. If you find it genuinely needs a data model change, stop
   and report why before changing the schema.

INDEPENDENTLY VERIFY (don't just re-assert the prior session's claims):
3. Run lint on the full changed file set. For each of the 12 previously-reported
   pre-existing errors (4 set-state-in-effect, 8 no-unescaped-entities in StatsPage/
   Planner/StudyHub/FolderTreePicker), confirm via git diff/git blame that none fall on
   lines actually touched this session or last. Report the actual command output, not a
   summary.
4. Show the full diff for src/lib/archive.ts specifically — the cycle-guard and
   orphaned-parent-guard logic is the highest-risk part of this change and needs a human-
   readable diff, not just a description.
5. Manually retest in-browser: archive a folder → individually unarchive one deck inside
   it → confirm the new UI feedback from step 1 actually appears → unarchive the folder →
   confirm that deck (and only that deck, not others archived individually) comes back
   correctly.

======================================================================
PART B — Mobile responsive layout audit and fix
======================================================================

Bug: Website looks broken/bad on mobile phone screens. Audit and fix responsive layout
issues across the site.

INVESTIGATE FIRST:
1. Check the HTML head for a viewport meta tag:
   <meta name="viewport" content="width=device-width, initial-scale=1">
   If missing, this alone causes mobile browsers to render at desktop width and zoom out —
   report if it's missing and where it needs to go (likely _document.tsx/layout.tsx or
   equivalent root template).
2. Grep the codebase for fixed pixel widths on layout containers, nav bars, cards, modals,
   and tables (width: NNNpx, min-width: NNNpx) — list every offender with file/line, and
   flag which ones are large enough to cause horizontal overflow/scroll on a ~375–430px
   wide screen.
3. Check whether the site uses Flexbox/Grid with wrapping (flex-wrap, grid-template-columns
   with minmax/auto-fit) or rigid multi-column layouts that don't reflow on small screens.
4. Search for existing @media (max-width: ...) breakpoints — report what exists today and
   what pages/components have NONE (meaning they only render the desktop layout at every
   size).
5. Check images and tables for missing max-width: 100%; height: auto (or equivalent), which
   causes overflow on phones.
6. Check font sizes — are they using rem/em (scalable) or hardcoded px that stays too large/
   small on small screens?
7. Report every location found with file/line references BEFORE making changes, grouped by
   severity (breaks layout / causes horizontal scroll, vs. just looks cramped/off).

FIX:
- Add the viewport meta tag if missing.
- Replace fixed-px widths on layout containers with responsive equivalents (max-width +
  width: 100%, or flex/grid with wrapping) — preserve the existing visual design intent,
  don't redesign, just make it reflow.
- Add missing media query breakpoints for components that need real restructuring on small
  screens (e.g. nav collapsing, multi-column grids going to 1 column, sidebars stacking
  below content).
- Ensure images/tables don't overflow their container on narrow viewports.
- Test against common breakpoints: 375px (small phone), 390-430px (standard phone), 768px
  (tablet) — don't just eyeball one size.

======================================================================
VERIFY (both parts)
======================================================================
- Run tsc --noEmit and next build, fix any resulting errors.
- Do not commit or push. Leave changes unstaged.
- List every file touched with a one-line summary, grouped under "Part A" and "Part B"
  so the diffs are easy to review separately.

Append to CLAUDE.md under "## Session Log": this prompt (verbatim), findings, and fix
summary — 3-4 lines MAX. If the actual entry is longer than that when you're done, trim
it before appending — don't paste the full chat response in.

**A —** Display-layer only, no third state needed: `ArchivedDot` now renders inherited archive as a muted `FolderArchive` glyph with "Inherited from archived folder — unarchive the folder to restore", distinct from the red `Archive` of a self-archived item. Verified in a real browser (Playwright against the static export): unarchiving a self-archived deck inside an archived folder visibly flips red→muted where it was previously a no-op, and unarchiving the folder restored exactly the two inherited decks while the individually-archived one stayed archived. Independently re-checked the prior session's lint claim — all 12 (now 15, as Part B widened the changed set) errors are pre-existing, confirmed by intersecting each error line against `git diff -U0 HEAD` hunks (0 hits) and `git blame` dating them to commits d15e9dec/25a1f39d/f4e39236/ddfcb9ad.
**B —** Viewport meta was already correct (`layout.tsx:25`); the real bug was the shell: a fixed 260px sidebar as a flex sibling left **130px of a 390px phone** for the whole app, and `overflow-hidden` on the content column *clipped* the remainder rather than letting it scroll — so nothing was reachable. Sidebar is now an off-canvas drawer below `md` (backdrop + `MobileNavButton` hamburger), restoring the content column to the full 390px. Trap worth remembering: `cn()` runs tailwind-merge, which collapsed `fixed` against a call-site `relative` and silently kept the drawer in flow — use `md:relative`, never a bare `relative`, alongside it. Also: 8 never-collapsing `grid-cols-N`, `SettingsPanel`'s `w-[480px]`, the ~480px header toolbar (now sideways-scrolling below `md`), page gutters, and a global `img/video { max-width: 100% }` guard (markdown card content had none).

### Investigation: newly learned cards getting short intervals (1–3 days) — BUG or FSRS feature?

**Verdict: FEATURE, not a bug.** Replayed 40+ cards' review histories through official ts-fsrs with user settings (target_retention=0.99, custom weights, enable_short_term). All outputs matched stored fsrs_data exactly. Same-day graduation confirmed working (learning → 10min step → review state). The 1-2 day intervals are mathematically correct: target_retention=0.99 produces 80–85% shorter intervals than the 0.90 default because it requires more frequent reviews to maintain 99% recall. Full analysis: R=0.99 → 2nd review due 1d later vs R=0.90 → 5d later. **Not a code fix; a settings question:** user can lower target_retention (0.90–0.95) to extend intervals, or keep 0.99 for aggressive review schedule. No changes made; awaiting direction.

### Fix: Settings button no longer opens panel (event propagation bug)

**Root cause:** Button's click event bubbled to backdrop, which immediately closed the panel — `setSettingsOpen(true)` then `setSettingsOpen(false)` in same event cycle. Happened after toggle fix because previous `setSettingsOpen(true)` always-true pattern masked the propagation bug; toggle exposes it. **Fix:** Added `e.stopPropagation()` to both settings buttons (collapsed + expanded) and close button in SettingsPanel header. Now: open/close toggles correctly, backdrop click closes without interference, Escape closes without interference.

### Fix: settings panel rendered as a faint vertical line

Prompt: settings tap shows only a faint white line; investigate CSS/positioning. **Root cause:** the mobile-drawer `translate` on `<aside>` made it the containing block for the panel's `position: fixed`, so the panel collapsed to zero width. **Fix:** portal the panel to `<body>`; the offset now follows the sidebar's real width.

### Redo-missed loop + once-per-day write gate

Prompt: refix redo-missed screen; audit all card interfaces. **Found:** redo pass ran once; Undo there reverted first-pass reviews; cram/random/failed/"Review Again" re-rated answered cards. **Fix:** redo loops until zero misses; `handleRate` writes only if new or in `getReviewsDue`.

### Session summary: always shown, dashboard exit, New Cards tiles

Prompt: summary always at session end; Back→Dashboard; New Cards metrics. **Fix:** queue emptied by deletes now reaches summary; button routes `/`; New Cards sessions show Time Elapsed/Cards Learned/Repetitions from per-rating capped times.
