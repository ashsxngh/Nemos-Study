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
  mastery_percent  int  not null default 0
);

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
  ease               float not null default 2.5
);

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

-- ────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────
alter table folders        enable row level security;
alter table decks          enable row level security;
alter table cards          enable row level security;
alter table srs_data       enable row level security;
alter table review_logs    enable row level security;
alter table review_sessions enable row level security;
alter table notes          enable row level security;
alter table exams          enable row level security;

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

-- ────────────────────────────────────────────────────────────
-- INDEXES
-- ────────────────────────────────────────────────────────────
create index if not exists idx_folders_user_id        on folders        (user_id);
create index if not exists idx_decks_user_id          on decks          (user_id);
create index if not exists idx_cards_user_id          on cards          (user_id);
create index if not exists idx_srs_data_user_id       on srs_data       (user_id);
create index if not exists idx_srs_data_due_date      on srs_data       (due_date);
create index if not exists idx_review_logs_user_id    on review_logs    (user_id);
create index if not exists idx_review_sessions_user_id on review_sessions (user_id);
create index if not exists idx_notes_user_id          on notes          (user_id);
create index if not exists idx_exams_user_id          on exams          (user_id);
