-- ============================================================
-- Al Saif — schema v2  (run once in Supabase → SQL Editor → Run)
-- Adds: map pin columns + the car/transport shared inbox.
-- Safe to re-run.
-- ============================================================

-- 1) Map pin coordinates on properties (for the "Place pins" tool)
alter table properties add column if not exists lat double precision;
alter table properties add column if not exists lng double precision;

-- 2) Transport / car requests — a shared inbox the whole family can see & fulfill
create table if not exists transport_requests (
  id uuid primary key default gen_random_uuid(),
  booking_id   uuid references bookings(id)   on delete set null,  -- optional link to a stay
  property_id  uuid references properties(id) on delete set null,  -- destination villa
  requested_by text not null references users(id),
  for_whom     text,                       -- "Dad's 6 business guests", "Sara + 2 friends"
  passengers   int  default 1,
  cars         int  default 1,
  car_type     text default 'suv',         -- sedan | suv | van | mix
  pickup_location text,                     -- airport / city
  pickup_at    timestamptz,                 -- when the car is needed
  notes        text,                        -- flight no., special requests
  status       text default 'requested',   -- requested | arranged | done | cancelled
  arranged_by  text references users(id),   -- who took care of it
  created_at   timestamptz default now()
);

create index if not exists transport_status_idx  on transport_requests(status);
create index if not exists transport_booking_idx on transport_requests(booking_id);

alter table transport_requests enable row level security;
drop policy if exists "open all transport" on transport_requests;
create policy "open all transport" on transport_requests for all using (true) with check (true);

-- 3) Live sync (optional but nice) — new requests appear instantly for everyone
do $$ begin alter publication supabase_realtime add table transport_requests; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table properties;          exception when others then null; end $$;
