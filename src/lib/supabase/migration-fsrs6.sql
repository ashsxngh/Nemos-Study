-- ============================================================================
-- FSRS-6 migration: fsrs_data columns for the official ts-fsrs card shape
-- ============================================================================
-- Run once in the Supabase SQL Editor. Purely additive and backwards
-- compatible: every column is NOT NULL with a default, so rows written by an
-- older build (which simply omit these keys) still insert cleanly, and an older
-- build reading the table just ignores the extra columns.
--
-- Context: Nemos' scheduler is now the official Open Spaced Repetition
-- implementation (`ts-fsrs`, FSRS-6) rather than a hand-written one. FSRS-6's
-- `Card` carries two fields Nemos never persisted, both of which are real
-- scheduling state and must survive a round-trip through the server:
--
--   learning_steps    Index into the configured learning/relearning steps.
--                     Without it, a card mid-way through the short-term step
--                     machine restarts its steps after every sync.
--   scheduled_days    The whole-day interval FSRS last assigned (0 for a
--                     sub-day learning step). Already present on this table as
--                     an unused legacy column — now actually written.
--
-- plus one Nemos-owned bookkeeping column:
--
--   scheduler_version 0/absent = row produced by the retired custom scheduler;
--                     6 = genuine FSRS-6 state. Read by the client-side
--                     migration (src/lib/fsrsMigration.ts) to know which rows
--                     still need reconstructing from review_logs, so the
--                     migration is idempotent and safe to re-run.
-- ============================================================================

alter table fsrs_data add column if not exists learning_steps    int not null default 0;
alter table fsrs_data add column if not exists scheduler_version int not null default 0;

-- Pre-existing legacy column, previously always 0 and documented as unused.
-- Kept as-is (nullable, defaulted) and now genuinely written by the client.
alter table fsrs_data add column if not exists scheduled_days    int default 0;

-- ── Verification ────────────────────────────────────────────────────────────
-- Expect learning_steps / scheduler_version / scheduled_days to be listed.
--
--   select column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--   where table_name = 'fsrs_data'
--   order by ordinal_position;
--
-- After the client has run its migration, every row should report version 6:
--
--   select scheduler_version, count(*) from fsrs_data group by 1;
