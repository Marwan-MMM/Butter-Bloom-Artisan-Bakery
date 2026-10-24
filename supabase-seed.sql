-- =============================================================================
--  BUTTER & BLOOM — DEMO SEED
--  Run AFTER supabase-schema.sql.
-- =============================================================================
--
--  WHAT THIS DOES
--    Calls public.load_demo_catalog(), which seeds the entire demo catalog in
--    one call:
--      · 10 categories (cakes, cupcakes, croissants, ... seasonal)
--      ·  5 collections (valentines, mothers-day, birthday, wedding, holiday)
--      · 30 products with cover images, copy, ingredients, allergens and
--        servings info (5 of them also carry add-on options)
--      · the site_settings row with warm defaults (announcement, hours,
--        socials, currency, delivery rules, custom-cake sizes and extras)
--      · 3 sample testimonials
--    Every demo row is tagged is_demo = true + demo_batch_id = 'bb-demo-v1'.
--
--  HOW TO RUN
--    Supabase Dashboard → SQL Editor → paste this file → Run.
--    Expected result: a single row like
--      {"loaded": 30, "skipped": false, "categories": 10, ...}
--
--  GOOD TO KNOW
--    · IDEMPOTENT — safe to run again and again. If the demo batch
--      'bb-demo-v1' is already loaded, the call returns
--      {"loaded": 0, "skipped": true, "message": "Demo data already loaded"}
--      and nothing changes.
--    · The admin panel (admin.html → Demo Data tab) can also Load, Remove or
--      Replace (remove + load) the demo data via the very same RPC functions —
--      no SQL needed once the bakery admin account exists.
--    · Removing demo data only deletes rows flagged is_demo/demo_batch_id, so
--      your own products, settings edits and orders are never touched.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Prerequisite check: make sure the schema from supabase-schema.sql exists
-- before attempting to seed, and fail with a clear message if it does not.
-- ---------------------------------------------------------------------------
do $seed_prerequisites$
begin
  if to_regclass('public.products') is null
     or to_regclass('public.site_settings') is null
     or to_regprocedure('public.load_demo_catalog()') is null then
    raise exception 'Prerequisites missing: run supabase-schema.sql first, then re-run this file.';
  end if;
end
$seed_prerequisites$;

-- ---------------------------------------------------------------------------
-- Load (or skip) the demo catalog.
-- ---------------------------------------------------------------------------
select public.load_demo_catalog() as demo_load_result;
