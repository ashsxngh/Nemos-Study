-- ============================================================
-- One-time migration: SM-2 removal (2026-07)
-- Run this in the Supabase SQL Editor against the EXISTING
-- database. New databases don't need it — schema.sql no longer
-- creates any of these objects.
--
-- Precondition (verified before this migration was written):
-- no user has algorithm = 'sm2' in user_settings, so no data
-- conversion is required.
-- ============================================================

-- The SM-2 scheduling table. fsrs_data is the only scheduling
-- store now; the client no longer reads or writes srs_data.
drop trigger if exists trg_srs_data_updated_at on srs_data;
drop table if exists srs_data;

-- The algorithm choice column — FSRS is the only algorithm, so
-- the setting no longer exists client-side.
alter table user_settings drop column if exists algorithm;
