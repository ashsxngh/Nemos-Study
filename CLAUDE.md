@AGENTS.md

# Sync architecture (`src/hooks/useSync.ts`)

`useSync` is a single React hook mounted once at the app layout level. It owns all Supabase communication.

## Key module-level singletons

These live outside the hook and persist for the entire browser session:

- `lastPushedSrs` / `lastPushedFsrs` — Maps of `cardId → JSON` used for dirty tracking; prevents re-upserting unchanged SRS/FSRS rows on every debounce cycle. Seeded from server on each pull. Cleaned up when cards are deleted.
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

Besides the mount-time pull, the leader tab also calls `pullFromSupabase()` (incremental — it reuses the `nemos-last-pull-at` watermark, same as any other pull after the first) on a `visibilitychange` event (tab becomes visible again) and every 5 minutes via `setInterval` while active. This is what keeps a tab open all day from drifting out of sync with `fsrs_data`/`srs_data` changes made on another device — the `review_logs` Realtime feed alone doesn't carry those scheduling updates.

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

Four medium-priority bugs fixed from a full codebase audit:

- **`src/store/useHistoryStore.ts`** — `pruneHistory` now returns the `{ sessionIds, logIds }` it removed instead of silently dropping them, so callers can queue them for remote deletion.
- **`src/store/useLibraryStore.ts`** — `PendingDeletes` gained `sessions`/`reviewLogs` buckets; `deleteFolder`/`deleteDeck` populate them from `pruneHistory`'s return value; `clearPendingDeletes` clears them after a successful push.
- **`src/hooks/useSync.ts`** — `pushToSupabase` now deletes queued `review_sessions`/`review_logs` rows from Supabase (batched, dirty-tracking cleanup, deadlock-avoidance excludes), the same way folders/decks/cards are handled; `runPull` filters pending-deleted sessions/logs out of pulled rows so they can't resurrect before the push completes; `handlePush`'s BroadcastChannel message and cross-tab handler now propagate session/log deletions too.
- **`src/hooks/useSync.ts`** — `runPull` now tracks `anyError` across all ten tables (not just the incremental-pull path) and skips `setLastPullAt` on a full pull if any table errored, so a partial failure no longer silently advances the watermark past unfetched rows.
- **`src/store/useSettingsStore.ts`** — added a new `burnoutTimeWarningEnabled` flag, separate from `burnoutWarningEnabled`.
- **`src/components/settings/SettingsPage.tsx`** / **`SettingsPanel.tsx`** — the "Warn when projected study time exceeds" toggle now reads/writes `burnoutTimeWarningEnabled` instead of sharing `burnoutWarningEnabled` with the queue-threshold toggle.
- **`src/app/(app)/trash/page.tsx`** — "Clear all" now awaits every `deleteFromSupabase` call (via `Promise.all`) before clearing the trash store and closing the confirm dialog, shows a loading state on the button while in flight, and fires a "Trash cleared." success toast on completion; `deleteFromSupabase` now also deletes the matching `fsrs_data` row(s) for both the single-card and deck-cards paths (previously only `srs_data` and `cards`/`decks` were deleted, orphaning `fsrs_data` server-side).
- Also updated `src/lib/deleteAllData.ts` and `src/lib/migrateLegacyIds.ts` to include the new `PendingDeletes.sessions`/`reviewLogs` fields so the type stays consistent everywhere it's constructed.

Verified via `tsc --noEmit` and `next build` (both clean). Could not exercise the live UI — the dev server requires an authenticated Supabase session and no credentials were available in this session.

### Code quality audit

- **`src/components/dashboard/PeriodStats.tsx`** — "Cards reviewed" now dedupes by `cardId` (`uniqueCardCount`); "Total reviews" stays the raw log count. They were both showing `curLogs.length` before.
- **`src/app/(auth)/forgot-password/page.tsx`** (new) / **`src/app/(auth)/reset-password/page.tsx`** (new) — built the missing password-reset flow (`supabase.auth.resetPasswordForEmail` → email link → `/reset-password` exchanges the recovery code and calls `supabase.auth.updateUser({ password })`). `login/page.tsx`'s `/forgot-password` link now resolves.
- **`src/proxy.ts`** — added `/forgot-password` and `/reset-password` to a new `isPasswordResetFlow` bypass so neither the logged-out redirect nor the logged-in-on-auth-page redirect can strand the recovery flow (the recovery code-exchange lands a session client-side, which would otherwise get yanked to `/` on refresh).
- **`src/store/useAppStore.ts`** — added persisted `plannerTasks` + `addPlannerTask`/`togglePlannerTask` actions. **`src/components/planner/PlannerPage.tsx`** now reads/writes tasks through the store instead of a local `useState` seeded with hardcoded values on every mount (tasks used to reset on navigation).
- **`src/components/library/FolderTreePicker.tsx`** now exports `buildFolderTree`/`FolderNode`; **`src/app/(app)/import/page.tsx`** imports them instead of maintaining a byte-identical copy.
- **`src/components/ui/Menu.tsx`** (new) — shared `useDismiss` hook (outside-click + Escape) and `AnchoredMenu`/`MenuItemRow` components. Consolidates the three hand-rolled dropdown implementations: `LibraryBrowser.tsx`'s `ItemDropdown`, and `Header.tsx`'s account + notifications menus (each used to duplicate its own open-state/ref/mousedown-listener boilerplate). **`src/components/ui/ContextMenu.tsx`** (right-click menu, unused elsewhere but kept) now builds on the same `useDismiss`/`MenuItemRow` primitives instead of its own copy.
- **`src/lib/deleteUndo.ts`** (new) — `restoreCardsFromTrash` (put trashed cards back into the library store, preferring the trash snapshot and falling back to a caller-supplied in-memory card) and `createUndoTracker<T>` (generic track/consume/peek with a timeout window). Replaces the duplicated restore-from-trash logic and hand-rolled ref+timer bookkeeping in **`src/components/library/DeckView.tsx`**'s `trackDeleteForUndo` and **`src/app/(app)/study/session/page.tsx`**'s quick-delete (`D` key) undo.
- **`src/store/useAppStore.ts`**, **`src/app/(app)/study/session/page.tsx`**, **`src/store/useStudyStore.ts`** — replaced `Math.random().toString(36).slice(2)` id generation with `generateId()` (toast ids, review-log undo ids, study-session ids). Left `useSync.ts`'s realtime channel-name suffix alone (not a persisted id, and sync logic is out of scope).
- **`src/components/settings/SettingsPage.tsx`** — removed the dead "Exam countdown alerts" and "Goal completion" notification toggles (hardwired `checked={false} onChange={() => {}}`, no backing setting existed anywhere).
- **`src/components/settings/SettingsShared.tsx`** (new) — extracted everything that was byte-for-byte duplicated between `SettingsPage.tsx` (930 lines) and `SettingsPanel.tsx` (836 lines): `Toggle`, `SettingRow`, `NumberField` (replaces the old generic-key `numInput` closure duplicated in both files), `AlgorithmPicker`, `FSRSWeightsGrid` + `ResetFSRSDefaultsButton` + `FSRS5_DEFAULT_WEIGHTS`, `BurnoutThresholdToggles` (the two queue/time toggle rows fixed earlier this session), `THEMES`, and `DataBackupSection` (a fully self-contained export/import/delete-all-data block, including the CSV-import dialog and the delete-all confirm — both now built on the shared `Dialog` component instead of each file's own raw `fixed inset-0` overlay). Both settings files now import these instead of maintaining parallel copies; each keeps only what's genuinely different (Page's sidebar-nav shell, card-appearance customization, and Optimize-weights button; Panel's slide-over shell and customizable `ShortcutRecorder`).

Verified via `tsc --noEmit`, `next build`, and `eslint` on every touched file (both clean — the handful of remaining lint errors, e.g. `Date.now()` purity in the projected-load calculation, predate this session and weren't touched). Could not exercise the live UI for the same reason as above (no Supabase credentials available in this session).

### Performance + security audit

- **Selector subscriptions** — converted every whole-store call site (`useLibraryStore()`, `useHistoryStore()`, and most `useAppStore()`/`useSettingsStore()`/`useExamStore()`/`useNotesStore()`/`useTrashStore()` call sites with no selector) to granular selectors, using `useShallow` from `zustand/react/shallow` wherever more than one field is pulled. Touched: `Sidebar.tsx`, `StatsPage.tsx`, `LibraryBrowser.tsx` (both the main component and `LibraryTreeTable`), `DeckView.tsx`, `StudyHub.tsx`, `study/inbox`, `study/new`, `study/reviews`, `study/session/page.tsx`, `DailyQueue.tsx`, `CommandPalette.tsx`, `HardestTopics.tsx`, `StatsOverview.tsx`, `ExamCountdowns.tsx`, `RecentActivity.tsx`, `StreakHeatmap.tsx`, `PeriodStats.tsx`, `ThemeProvider.tsx`, `Header.tsx`, `FSRSSimulator.tsx`, `SettingsShared.tsx`, `SettingsPanel.tsx`, `SettingsPage.tsx` (partial — see below), `CardEditor.tsx`, `CreateDeckDialog.tsx`, `CreateFolderDialog.tsx`, `NotesLayout.tsx`, `notes/page.tsx`, `import/page.tsx`, `stats/page.tsx`, `PlannerPage.tsx` (4 call sites), `trash/page.tsx`. Left `SettingsPage.tsx`/`SettingsPanel.tsx`'s `const settings = useSettingsStore()` whole-object destructure alone — those two files read dozens of individual settings fields throughout ~900 lines each and settings screens aren't on the hot render path the audit flagged (`useLibraryStore`/`useHistoryStore`); fully enumerating every field for those two files was judged not worth the risk/reward here.
- Wherever a query function (`getDueCards`, `getNewCards`, `getReviewsDue`, `getDeckMastery`, etc.) is called directly during render, the call is now wrapped in `useMemo` keyed off the store fields it actually reads internally via `get()`/`getState()` (typically `cards`, `decks`, `folders`, `srsData`, `fsrsData`, plus `reviewLogs`/`algorithm`/`newCardsPerDay` where the query depends on them) — otherwise a granular selector alone would still recompute on every render even though the component only re-renders on relevant changes.
- **`src/store/useLibraryStore.ts`** — `getNewCards` no longer calls `reviewLogs.some(...)` per card (O(cards × logs)); it precomputes a `Set` of card ids with a `wasNew` log today in one pass over `reviewLogs` first (O(logs + cards)).
- **`src/components/layout/Sidebar.tsx`** — `getNewCards()`/`getReviewsDue()`/`getDueCards()` (previously called fresh on every render, including every rating echo during a study session) are now `useMemo`'d against granular selectors from `useLibraryStore`/`useHistoryStore`/`useSettingsStore`.
- **`src/components/library/LibraryBrowser.tsx`** — `getDueCards(deck.id)` (used in the "Has due cards" filter and "Most due" sort) and `getDeckCards`/`getDeckMastery` are now precomputed once per render into `Map<deckId, …>` lookups (`dueCountByDeck`, `cardCountByDeck`, `masteryByDeck`), memoized on `cards`/`srsData`/`fsrsData`/`algorithm`, instead of being called per deck inside filter/sort comparators. `getRecursiveCardCount` now takes the `cardCountByDeck` map instead of a `getDeckCards` function so folder card-count rollups are O(1) lookups instead of O(cards) each. `LibraryTreeTable`'s `getNewCards(deckId)` calls (used recursively for the tree's new/total counts) are similarly precomputed into a `deckCountsByDeck` map.
- **`src/store/useLibraryStore.ts`** — added `updateCardsBatch(updates)` (applies many card field updates in a single `setState`) and `deleteCardsBatch(ids)` (same idea for deletes — still writes one trash entry per card, but a single `cards`/`srsData`/`fsrsData` `setState` instead of N). **`src/components/library/DeckView.tsx`** now uses these for drag-reorder, bulk move, bulk tag, and bulk delete instead of looping `updateCard`/`deleteCard` once per card (500 cards previously meant 500 full-array clones + 500 IndexedDB writes).
- **`src/app/(app)/trash/page.tsx`** — `deleteFromSupabase` now calls `getCachedUserId(supabase)` instead of `supabase.auth.getUser()`, matching every other file's pattern (avoids an extra network round-trip per delete).
- **`src/lib/limits.ts`** (new) — `CARD_TEXT_MAX_LENGTH` (10,000), `NOTE_CONTENT_MAX_LENGTH` (100,000), `NAME_MAX_LENGTH` (255). Enforced in two layers: the store actions themselves (`useLibraryStore.ts`'s `createCard`/`importCards`/`updateCard`/`updateCardsBatch`/`createFolder`/`updateFolder`/`createDeck`/`updateDeck`, `useNotesStore.ts`'s `updateNote`) clamp with a `clamp(str, max)` helper so oversized content can't reach the store via any path (including CSV/Anki import, which routes through `importCards`) even if a caller bypasses the UI; and the actual input elements (`CardEditor.tsx`'s front/back textareas, `CreateDeckDialog.tsx`/`CreateFolderDialog.tsx`'s name `Input`, `NotesLayout.tsx`'s title input and content textarea) got `maxLength` for immediate feedback.

Verified via `tsc --noEmit` and `next build` (both clean). `eslint` shows only the same pre-existing errors noted above in files untouched by this pass. Could not exercise the live UI for the same reason as prior entries (no Supabase credentials available in this session).

### Architecture audit — three remaining sync gaps

- **`src/hooks/useSync.ts`** — added leader election via a new `'nemos-sync-leader'` Web Lock (`isLeaderRef`, acquired by holding the lock open with a never-resolving promise, released on unmount/tab-close so another tab can take over). A new effect fires an incremental `pullFromSupabase()` (reuses the existing `nemos-last-pull-at` watermark path — no full-pull fallback added) on `visibilitychange` (tab becomes visible) and every 5 minutes via `setInterval`, gated to the leader tab and skipped while offline; both the listener and interval are cleaned up on unmount. Fixes a tab left open all day silently drifting out of sync with another device's `fsrs_data`/`srs_data` changes (the `review_logs` Realtime feed alone doesn't carry those).
- **`src/hooks/useSync.ts`** / **`src/lib/supabase/schema.sql`** — `user_settings` gained `fsrs_weights` (jsonb), `target_retention` (float8), `daily_review_limit` (int), `algorithm` (text) columns (`ALTER TABLE` statements added for existing databases — needs to be run manually in the Supabase SQL Editor, not auto-applied). `pushSettingsToSupabase`/`handleSettingsPush` now take a `SyncedSettings` object (`newCardsPerDay`, `fsrsWeights`, `fsrsTargetRetention`, `maxReviewsPerDay`, `algorithm`) instead of just `newCardsPerDay`; the settings-store subscriber, the mount-time seed push, and the `settings-push-complete` BroadcastChannel message all carry the full object now. `runPull` hydrates all four fields from the server row (each guarded so a legacy row with null columns doesn't blank out local state). Same last-write-wins-via-`updated_at` pattern as every other table — no new conflict logic needed beyond wiring the fields through. Previously only `newCardsPerDay` synced, so two devices could schedule the same card differently.
- **`src/hooks/useSync.ts`** — added `dropStaleOverwrites`, a compare-and-swap guard called before upserting the dirty-filtered `folders`/`decks`/`cards` rows: it fetches the server's current `updated_at` for those ids (batched, `user_id`-scoped) and drops any row whose local `updatedAt` is older than the server's. A device offline for a while can no longer push over an edit another device already synced — rows dropped this way stay out of the `lastPushedX` dirty-tracking maps, so they're retried next push cycle, and the next pull brings in the server's newer copy, which self-resolves the conflict. Scoped to folders/decks/cards only, per the task (srs_data/fsrs_data/sessions/review_logs untouched — those already have their own dirty-tracking/deadlock-avoidance logic and weren't in scope).

Verified via `tsc --noEmit` and `next build` (both clean). `eslint` on `useSync.ts` shows the same 2 pre-existing issues confirmed present before this session's changes too (`git stash` diff comparison) — a `setState`-in-effect lint error in the mount effect and a missing-deps warning on the realtime-subscription effect, both predating this session. Could not exercise the live UI for the same reason as prior entries (no Supabase credentials available in this session). Did not touch SM2 code, `srs.ts`, or anything outside the sync layer, per instructions.
