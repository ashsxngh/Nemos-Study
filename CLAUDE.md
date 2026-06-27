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
- **BroadcastChannel** `'nemos-sync'` — tabs post messages after a push so peers can apply deletions and settings changes immediately rather than waiting for their next pull.

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
