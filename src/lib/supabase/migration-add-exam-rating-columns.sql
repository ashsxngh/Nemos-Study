-- schema.sql already declares these two columns (added alongside exam
-- targeting/rating support), but that ALTER never ran against the live
-- database — confirmed by querying PostgREST directly: both `rating` and
-- `predicted_retention_at_exam` return 42703 "column does not exist" while
-- every other exams column (including deck_ids/folder_ids/target_retention,
-- added in the same schema.sql block) resolves fine. Run this once in the
-- Supabase SQL Editor to catch the live table up; idempotent, safe to re-run.
alter table exams add column if not exists rating int;
alter table exams add column if not exists predicted_retention_at_exam float;
