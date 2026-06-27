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
