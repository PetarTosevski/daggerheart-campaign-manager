-- Task 009A: a campaign name must be unique per owner.
--
-- Enforces the "duplicate campaign name for the same owner" rule at the database
-- level so it holds regardless of mutation path and is race-free. The comparison
-- is case-insensitive and trims surrounding whitespace, matching the trimmed,
-- non-blank name the application validates and stores. Names may still repeat
-- across different owners.

create unique index campaigns_owner_name_unique
  on public.campaigns (owner_id, lower(btrim(name)));
