-- ============================================================
-- Al Saif — Family Property Concierge
-- Paste this entire file into Supabase → SQL Editor → Run.
-- Safe to re-run (uses IF NOT EXISTS / ON CONFLICT).
-- ============================================================

-- USERS (just the 4 family members; password-less, pick-your-avatar)
create table if not exists users (
  id text primary key,
  name text not null,
  emoji text,
  color text,
  sort_order int default 0
);

insert into users (id, name, emoji, color, sort_order) values
  ('fahad',  'Fahad',  '🌊', '#0c4a6e', 1),
  ('mishal', 'Mishal', '⭐', '#c9a64c', 2),
  ('nouf',   'Nouf',   '🌸', '#be185d', 3),
  ('salman', 'Salman', '🦅', '#047857', 4)
on conflict (id) do update set
  name = excluded.name,
  emoji = excluded.emoji,
  color = excluded.color,
  sort_order = excluded.sort_order;

-- PROPERTIES
create table if not exists properties (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  hotel text not null,
  location text not null,
  bedrooms int not null,
  nightly_rate_sar numeric not null default 0,
  color text default '#0c4a6e',
  description text,
  is_owned boolean default false,
  is_active boolean default true,
  notes text,
  sort_order int default 0
);

insert into properties (slug, name, hotel, location, bedrooms, nightly_rate_sar, color, description, is_owned, sort_order) values
  ('rosewood-5br',  'Rosewood — 5BR Villa',    'Rosewood',     'Shura Island', 5, 22000, '#0c4a6e', 'The crown jewel of Shura. Most beautiful villa on the island.', false, 1),
  ('rosewood-3br',  'Rosewood — 3BR Villa',    'Rosewood',     'Shura Island', 3, 14000, '#0369a1', 'Three-bedroom villa in the Rosewood rental program.',            false, 2),
  ('rosewood-2br',  'Rosewood — 2BR Villa',    'Rosewood',     'Shura Island', 2, 10000, '#0284c7', 'Two-bedroom villa in the Rosewood rental program.',              false, 3),
  ('fourseasons-2br','Four Seasons — 2BR (Home)','Four Seasons','Shura Island', 2, 12000, '#c9a64c', 'Second home. Not in the rental program — always available. Mom''s favourite.', true, 4),
  ('sls-1br',       'SLS — 1BR Suite',         'SLS',          'Shura Island', 1, 6500,  '#7c3aed', 'One-bedroom suite at SLS Shura.',                                false, 5),
  ('nammos-3br',    'Nammos — 3BR Penthouse',  'Nammos',       'Amaala',       3, 18000, '#be185d', 'Three-bedroom penthouse at Nammos Amaala.',                      false, 6)
on conflict (slug) do nothing;

-- BOOKINGS
create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  booked_by text not null references users(id),
  start_date date not null,
  end_date date not null,
  purpose text default 'family',          -- family | friends | business | solo | other
  guest_count int default 1,
  guest_names text,
  notes text,
  created_at timestamptz default now(),
  check (end_date >= start_date)
);

create index if not exists bookings_property_dates_idx on bookings(property_id, start_date, end_date);
create index if not exists bookings_user_idx on bookings(booked_by);

-- ROW LEVEL SECURITY — open for the family (publishable key + private URL)
alter table users     enable row level security;
alter table properties enable row level security;
alter table bookings  enable row level security;

drop policy if exists "open all users"      on users;
drop policy if exists "open all properties" on properties;
drop policy if exists "open all bookings"   on bookings;

create policy "open all users"      on users      for all using (true) with check (true);
create policy "open all properties" on properties for all using (true) with check (true);
create policy "open all bookings"   on bookings   for all using (true) with check (true);

-- REALTIME (optional) — lets every family member see new bookings appear
-- live without refreshing. Safe to re-run; ignores "already added".
do $$ begin alter publication supabase_realtime add table bookings;   exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table properties; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table users;      exception when others then null; end $$;
