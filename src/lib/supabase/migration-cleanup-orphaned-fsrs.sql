-- One-time cleanup: orphaned fsrs_data rows (no matching cards row).
--
-- Run manually in the Supabase SQL Editor, same as migration-drop-sm2.sql /
-- migration-add-realtime-publication.sql before it. Idempotent — safe to
-- re-run (a second run simply deletes zero rows).
--
-- Why these exist: card deletes originally removed only the cards row (and,
-- pre-SM-2-removal, the srs_data row) server-side, orphaning the matching
-- fsrs_data row. The client code has since been fixed on every delete path
-- (sync pendingDeletes push, trash-page permanent delete, deleteAllData), but
-- those fixes were forward-only — rows orphaned before them are re-downloaded
-- on every full pull, pruned locally, and never deleted server-side. This
-- migration is the retroactive half of that fix.
--
-- Note on prevention: fsrs_data.card_id deliberately has NO foreign key to
-- cards(id). The client pushes cards and fsrs_data upserts in parallel, so an
-- fsrs row can land before its cards row — an FK would turn that race into a
-- push failure. Orphan prevention lives in the client delete paths instead.
--
-- The join includes user_id so a row is only considered "matched" by its own
-- user's card (card ids are globally-unique UUIDs, so this is belt-and-braces).

-- 1) Preview — run this first and sanity-check the count (expected: ~702):
select count(*) as orphaned_fsrs_rows
from fsrs_data f
where not exists (
  select 1 from cards c
  where c.id = f.card_id
    and c.user_id = f.user_id
);

-- 2) The cleanup:
delete from fsrs_data f
where not exists (
  select 1 from cards c
  where c.id = f.card_id
    and c.user_id = f.user_id
);
