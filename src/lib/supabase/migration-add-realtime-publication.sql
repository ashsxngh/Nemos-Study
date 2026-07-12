-- ============================================================
-- One-time migration: add synced tables to the Realtime
-- publication (2026-07)
-- Run this in the Supabase SQL Editor against the EXISTING
-- database. New databases get the same block from schema.sql.
--
-- Why: useSync.ts subscribes to postgres_changes on folders,
-- decks, cards, and review_logs, but no table was ever added to
-- the supabase_realtime publication — so Postgres never emitted
-- change events for them and every realtime handler (INSERT,
-- UPDATE, and DELETE alike) was dead code. Adding the tables to
-- the publication is what actually turns the feed on.
--
-- REPLICA IDENTITY is deliberately left at DEFAULT (primary key
-- only): the client filters DELETE events by checking the id
-- against the local store, so the old-row payload never needs
-- more than the primary key.
-- ============================================================

do $$
declare
  t text;
begin
  foreach t in array array['folders', 'decks', 'cards', 'review_logs'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
