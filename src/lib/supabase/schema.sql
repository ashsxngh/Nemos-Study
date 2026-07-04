-- ============================================================
-- Nemo's Study — Supabase Database Schema
-- Paste this entire file into the Supabase SQL Editor and run it.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- EXTENSIONS
-- ────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ────────────────────────────────────────────────────────────
-- TABLES
-- ────────────────────────────────────────────────────────────

-- folders
create table if not exists folders (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  parent_id    uuid,
  name         text not null,
  color        text not null default 'default',
  is_starred   boolean not null default false,
  is_archived  boolean not null default false,
  "order"      int  not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- decks
create table if not exists decks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  folder_id    uuid,
  name         text not null,
  description  text not null default '',
  is_starred   boolean not null default false,
  is_archived  boolean not null default false,
  tags         text[] not null default '{}',
  "order"      int  not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- cards
create table if not exists cards (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  deck_id               uuid not null,
  type                  text not null default 'basic',
  front                 text not null default '',
  back                  text not null default '',
  hint                  text not null default '',
  tags                  text[] not null default '{}',
  is_pinned             boolean not null default false,
  is_archived           boolean not null default false,
  linked_card_ids       uuid[] not null default '{}',
  prerequisite_card_ids uuid[] not null default '{}',
  "order"               int  not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- srs_data
create table if not exists srs_data (
  card_id          uuid primary key,
  user_id          uuid not null references auth.users(id) on delete cascade,
  interval         int  not null default 0,
  ease_factor      float not null default 2.5,
  repetitions      int  not null default 0,
  due_date         timestamptz not null default now(),
  last_reviewed_at timestamptz,
  lapses           int  not null default 0,
  mastery_percent  int  not null default 0,
  state            text not null default 'new'
);

-- Adds the state column for databases created before it existed.
alter table srs_data add column if not exists state text not null default 'new';

-- Adds updated_at for incremental sync (lets the client filter "what changed
-- since my last pull" instead of always fetching the whole table).
alter table srs_data add column if not exists updated_at timestamptz not null default now();

-- fsrs_data — FSRS scheduling state, parallel to srs_data (SM-2). Previously
-- local-only (never synced), which left FSRS-mode queues stale on any device
-- that didn't perform the review.
create table if not exists fsrs_data (
  card_id          uuid primary key,
  user_id          uuid not null references auth.users(id) on delete cascade,
  stability        float not null default 0,
  difficulty       float not null default 0,
  retrievability   float not null default 0,
  due_date         timestamptz not null default now(),
  last_reviewed_at timestamptz,
  repetitions      int  not null default 0,
  lapses           int  not null default 0,
  state            text not null default 'new',
  updated_at       timestamptz not null default now()
);

-- Adds updated_at for databases created before this existed (incremental sync).
alter table fsrs_data add column if not exists updated_at timestamptz not null default now();

-- review_logs
create table if not exists review_logs (
  id                 uuid primary key default gen_random_uuid(),
  session_id         uuid not null,
  card_id            uuid not null,
  user_id            uuid not null references auth.users(id) on delete cascade,
  rating             int  not null,
  response_ms        int  not null default 0,
  reviewed_at        timestamptz not null default now(),
  scheduled_interval int  not null default 0,
  ease               float not null default 2.5,
  was_new            boolean not null default false
);

-- Adds the was_new column for databases created before it existed.
alter table review_logs add column if not exists was_new boolean not null default false;

-- review_sessions
create table if not exists review_sessions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  deck_id             uuid,
  started_at          timestamptz not null default now(),
  ended_at            timestamptz,
  cards_reviewed      int  not null default 0,
  cards_correct       int  not null default 0,
  cards_incorrect     int  not null default 0,
  average_response_ms int  not null default 0,
  mode                text not null default 'standard'
);

-- notes
create table if not exists notes (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  folder_id         uuid,
  title             text not null default '',
  content           text not null default '',
  is_starred        boolean not null default false,
  is_archived       boolean not null default false,
  tags              text[] not null default '{}',
  linked_note_ids   uuid[] not null default '{}',
  embedded_card_ids uuid[] not null default '{}',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- exams
create table if not exists exams (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  subject    text not null,
  date       date not null,
  notes      text not null default '',
  priority   text not null default 'medium',
  created_at timestamptz not null default now()
);

-- Adds columns for databases created before exam targeting/rating existed.
alter table exams add column if not exists deck_ids uuid[] not null default '{}';
alter table exams add column if not exists folder_ids uuid[] not null default '{}';
alter table exams add column if not exists target_retention float not null default 0.90;
alter table exams add column if not exists rating int;
alter table exams add column if not exists predicted_retention_at_exam float;

-- Adds updated_at for incremental sync filtering.
alter table exams add column if not exists updated_at timestamptz not null default now();

-- user_settings (one row per user; holds the SRS-relevant settings that must
-- schedule cards identically across devices)
create table if not exists user_settings (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  new_cards_per_day  int not null default 20,
  fsrs_weights       jsonb,
  target_retention   float8,
  daily_review_limit int,
  algorithm          text,
  updated_at         timestamptz not null default now()
);

-- Adds the column for a user_settings table created before this existed
-- ("create table if not exists" is a no-op against an already-existing
-- table, so an earlier partial run can leave this column missing).
alter table user_settings add column if not exists new_cards_per_day int not null default 20;
alter table user_settings add column if not exists updated_at timestamptz not null default now();

-- Adds SRS-relevant columns (fsrsWeights/targetRetention/dailyReviewLimit/algorithm)
-- so scheduling settings sync cross-device instead of staying per-device.
alter table user_settings add column if not exists fsrs_weights jsonb;
alter table user_settings add column if not exists target_retention float8;
alter table user_settings add column if not exists daily_review_limit int;
alter table user_settings add column if not exists algorithm text;

-- ────────────────────────────────────────────────────────────
-- INCREMENTAL SYNC TRIGGERS
-- ────────────────────────────────────────────────────────────
-- srs_data/fsrs_data/exams have no client-maintained updated_at field (unlike
-- folders/decks/cards/notes, which already stamp it on every local edit), so
-- a DB trigger stamps it on every insert/update instead. This is what lets
-- incremental pulls filter "rows changed since my last pull" for these tables.
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_srs_data_updated_at on srs_data;
create trigger trg_srs_data_updated_at before insert or update on srs_data
  for each row execute function set_updated_at();

drop trigger if exists trg_fsrs_data_updated_at on fsrs_data;
create trigger trg_fsrs_data_updated_at before insert or update on fsrs_data
  for each row execute function set_updated_at();

drop trigger if exists trg_exams_updated_at on exams;
create trigger trg_exams_updated_at before insert or update on exams
  for each row execute function set_updated_at();

-- ────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────
alter table folders        enable row level security;
alter table decks          enable row level security;
alter table cards          enable row level security;
alter table srs_data       enable row level security;
alter table fsrs_data      enable row level security;
alter table review_logs    enable row level security;
alter table review_sessions enable row level security;
alter table notes          enable row level security;
alter table exams          enable row level security;
alter table user_settings  enable row level security;

-- folders
create policy "Users can only access own data" on folders
  for all using (auth.uid() = user_id);

-- decks
create policy "Users can only access own data" on decks
  for all using (auth.uid() = user_id);

-- cards
create policy "Users can only access own data" on cards
  for all using (auth.uid() = user_id);

-- srs_data
create policy "Users can only access own data" on srs_data
  for all using (auth.uid() = user_id);

-- fsrs_data
create policy "Users can only access own data" on fsrs_data
  for all using (auth.uid() = user_id);

-- review_logs
create policy "Users can only access own data" on review_logs
  for all using (auth.uid() = user_id);

-- review_sessions
create policy "Users can only access own data" on review_sessions
  for all using (auth.uid() = user_id);

-- notes
create policy "Users can only access own data" on notes
  for all using (auth.uid() = user_id);

-- exams
create policy "Users can only access own data" on exams
  for all using (auth.uid() = user_id);

-- user_settings
create policy "Users can only access own data" on user_settings
  for all using (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────
-- INDEXES
-- ────────────────────────────────────────────────────────────
create index if not exists idx_folders_user_id        on folders        (user_id);
create index if not exists idx_decks_user_id          on decks          (user_id);
create index if not exists idx_cards_user_id          on cards          (user_id);
create index if not exists idx_srs_data_user_id       on srs_data       (user_id);
create index if not exists idx_srs_data_due_date      on srs_data       (due_date);
create index if not exists idx_fsrs_data_user_id      on fsrs_data      (user_id);
create index if not exists idx_fsrs_data_due_date     on fsrs_data      (due_date);
create index if not exists idx_review_logs_user_id    on review_logs    (user_id);
create index if not exists idx_review_sessions_user_id on review_sessions (user_id);
create index if not exists idx_notes_user_id          on notes          (user_id);
create index if not exists idx_exams_user_id          on exams          (user_id);
create index if not exists idx_user_settings_user_id  on user_settings  (user_id);

-- Incremental sync filters on these columns directly (in addition to user_id).
create index if not exists idx_srs_data_updated_at    on srs_data       (updated_at);
create index if not exists idx_fsrs_data_updated_at   on fsrs_data      (updated_at);
create index if not exists idx_exams_updated_at       on exams          (updated_at);
create index if not exists idx_review_logs_reviewed_at on review_logs   (reviewed_at);
