-- ============================================================
-- Al Saif — schema v3  (run once in Supabase → SQL Editor → Run)
-- The hard no-double-booking guarantee, enforced by the database
-- itself. Even if two people hit "Confirm" at the same second,
-- Postgres rejects the second one. Safe to re-run.
-- ============================================================

-- 0) Needed for the exclusion constraint below.
create extension if not exists btree_gist;

-- 1) Check-out must be after check-in. Fix any old same-day rows
--    first (they become one-night stays), then enforce it.
update bookings set end_date = start_date + 1 where end_date <= start_date;

do $$ begin
  alter table bookings add constraint bookings_dates_valid check (end_date > start_date);
exception when duplicate_object then null; end $$;

-- 2) THE GUARANTEE: two bookings for the same villa can never
--    overlap. Ranges are [check-in, check-out) — a checkout
--    morning frees the villa for a same-day check-in, like a
--    real hotel. The app understands the error and shows
--    "Those dates were just taken" instead of raw SQL noise.
--
--    NOTE: if this line ever errors with "could not create
--    exclusion constraint", two existing bookings overlap —
--    fix their dates in the app, then run this file again.
do $$ begin
  alter table bookings add constraint bookings_no_overlap
    exclude using gist (property_id with =, daterange(start_date, end_date, '[)') with &&);
exception when duplicate_object then null; end $$;
