-- Al Saif — add map pin coordinates to properties.
-- Run once in Supabase → SQL Editor → New query → Run.
-- Until this runs, pins placed in the app are saved on each device locally;
-- after it runs, placed pins sync to the whole family.

alter table properties add column if not exists lat double precision;
alter table properties add column if not exists lng double precision;
