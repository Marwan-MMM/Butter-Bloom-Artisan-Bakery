-- =============================================================================
--  BUTTER & BLOOM — SUPABASE SCHEMA
--  Premium artisan bakery website (static frontend + Supabase backend)
-- =============================================================================
--
--  HOW TO RUN
--    1. Open your Supabase project dashboard:  https://supabase.com/dashboard
--    2. Go to  SQL Editor  →  New query.
--    3. Paste this ENTIRE file and press  Run.
--    4. Afterwards run  supabase-seed.sql  (loads the demo catalog via
--       public.load_demo_catalog()).
--
--  WHAT THIS FILE CREATES
--    01  pgcrypto extension                    (gen_random_uuid)
--    02  set_updated_at()                      shared trigger function
--    03  12 tables                             full data model (spec section 4)
--    04  indexes                               query-friendly lookup paths
--    05  updated_at triggers                   auto-bump on every update
--    06  Row Level Security                    public read of published rows,
--                                              anon insert-only on orders/forms,
--                                              full access for authenticated
--                                              (bakery admins; no public sign-up)
--    07  Storage buckets + policies            product-images / cake-references
--    08  Demo data functions                   load_demo_catalog / remove_demo_catalog
--                                              (SECURITY DEFINER, admin-only)
--
--  SAFE TO RE-RUN
--    Every statement is idempotent: IF NOT EXISTS / OR REPLACE / DROP IF EXISTS
--    / ON CONFLICT DO NOTHING. Re-running never duplicates objects and never
--    deletes your data.
--
--  ROLES USED BY POLICIES (Supabase defaults)
--    anon           — visitors of the public website (no login)
--    authenticated  — bakery administrators, signed in via admin.html
--                     (accounts are created manually in Supabase Auth;
--                      there is no public sign-up on this site)
--    service_role   — server-side jobs; bypasses RLS by design
--
-- =============================================================================

begin;


-- =============================================================================
-- 01 · EXTENSIONS
-- =============================================================================

-- pgcrypto provides gen_random_uuid(), used as the default primary key of every
-- table and inside the order_number default expression. (Postgres 13+ also
-- ships gen_random_uuid() in core; enabling pgcrypto explicitly keeps the
-- behaviour identical on older Supabase projects.)
create extension if not exists pgcrypto;


-- =============================================================================
-- 02 · HELPER — shared updated_at trigger function
-- =============================================================================

-- Keeps updated_at honest on every UPDATE without the application having to
-- remember to set it. Applied to the "living" tables in section 05.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;


-- =============================================================================
-- 03 · TABLES
-- -----------------------------------------------------------------------------
-- Conventions shared by every table:
--   · id                 uuid primary key, default gen_random_uuid()
--   · created_at         timestamptz not null default now()
--   · updated_at         timestamptz not null default now()  (where applicable)
--   · is_demo            true on rows inserted by load_demo_catalog()
--   · demo_batch_id      tags the demo generation, currently 'bb-demo-v1'
--                        remove_demo_catalog() deletes ONLY rows carrying both
--                        flags, so admin-created content is never touched.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 03.a  categories — product taxonomy ("Cakes", "Croissants", ...)
--       Rendered as the category chip row in the shop and the category track
--       on the home page. Ordered by sort_order.
-- -----------------------------------------------------------------------------
create table if not exists public.categories (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,                     -- used in URLs: shop.html?category=cakes
  name          text not null,
  description   text,
  image_url     text,                                     -- './<image-file>.jpg' (repo root image)
  sort_order    integer not null default 0,
  is_active     boolean not null default true,            -- inactive categories are hidden from the public site
  is_demo       boolean not null default false,
  demo_batch_id text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint categories_slug_format check (slug = lower(slug))
);

comment on table public.categories is 'Product taxonomy shown in shop filters and the home category track.';

-- -----------------------------------------------------------------------------
-- 03.b  collections — seasonal / occasion collections ("valentines", "wedding"...)
--       Products reference collections by slug via products.seasonal_collections.
-- -----------------------------------------------------------------------------
create table if not exists public.collections (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,                     -- used in URLs: shop.html?collection=wedding
  name          text not null,
  description   text,
  image_url     text,                                     -- './collection-<name>.jpg'
  sort_order    integer not null default 0,
  is_active     boolean not null default true,
  is_demo       boolean not null default false,
  demo_batch_id text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint collections_slug_format check (slug = lower(slug))
);

comment on table public.collections is 'Seasonal/occasion collections; products link to them via products.seasonal_collections.';

-- -----------------------------------------------------------------------------
-- 03.c  products — the catalog
--       is_published gates public visibility (drafts stay admin-only).
--       is_visible   hides an item from shop/collection listings while keeping
--                    its direct product page working (e.g. slow-season items).
--       is_available marks a product "Sold out" without unpublishing it.
--       is_featured / is_best_seller / is_new drive the home page rails and
--                    the product card badges.
--       seasonal_collections is an array of collection slugs, filtered with
--                    the @> (contains) operator — see the GIN index below.
--       price >= 0 and a sane compare_at_price are enforced by CHECKs.
-- -----------------------------------------------------------------------------
create table if not exists public.products (
  id                   uuid primary key default gen_random_uuid(),
  slug                 text not null unique,              -- used in URLs: product.html?slug=...
  name                 text not null,
  short_description    text,                              -- card copy, kept <= 90 chars
  description          text,                              -- product page copy (2-3 sentences)
  category_id          uuid references public.categories (id),  -- NO cascade: deleting a category
                                                            -- that still has products is blocked
                                                            -- (admin UI shows a friendly error).
  price                numeric(10,2) not null,
  compare_at_price     numeric(10,2),                     -- "was" price; null = no discount shown
  is_available         boolean not null default true,
  is_published         boolean not null default false,    -- drafts default to unpublished
  is_visible           boolean not null default true,
  is_featured          boolean not null default false,
  is_best_seller       boolean not null default false,
  is_new               boolean not null default false,
  seasonal_collections text[] not null default '{}'::text[],  -- collection slugs, e.g. {valentines,wedding}
  ingredients          text,
  allergens            text,
  servings_info        text,                              -- portion size + storage guidance
  is_demo              boolean not null default false,
  demo_batch_id        text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint products_price_non_negative          check (price >= 0),
  constraint products_compare_price_non_negative  check (compare_at_price is null or compare_at_price >= 0),
  constraint products_slug_format                 check (slug = lower(slug))
);

comment on table public.products is 'Bakery catalog. Public sees only is_published rows; flags drive home page rails and badges.';

-- -----------------------------------------------------------------------------
-- 03.d  product_images — one or more photos per product
--       Exactly one row per product should have is_cover = true (the admin
--       editor enforces this). sort_order drives the gallery thumb order.
-- -----------------------------------------------------------------------------
create table if not exists public.product_images (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  url        text not null,                                -- './<image-file>.jpg' or a Storage public URL
  alt        text not null default '',                     -- accessibility text (never leave meaningless)
  sort_order integer not null default 0,
  is_cover   boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.product_images is 'Product photos; is_cover picks the card image, sort_order orders gallery thumbs.';

-- -----------------------------------------------------------------------------
-- 03.e  product_options — optional add-ons per product
--       choices is a jsonb array of {"label": string, "price_delta": number}.
--       is_required = true turns the card button into "Choose options" and
--       blocks add-to-cart until a choice is made (validated by product.js).
-- -----------------------------------------------------------------------------
create table if not exists public.product_options (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  name       text not null,                                -- e.g. "Personalise your cake"
  choices    jsonb not null default '[]'::jsonb,           -- [{"label":"Add gold leaf accents","price_delta":6}]
  is_required boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.product_options is 'Product add-on options; choices = jsonb array of {label, price_delta}.';

-- -----------------------------------------------------------------------------
-- 03.f  orders — checkout submissions (anon-insertable, admin-managed)
--       order_number is generated by the database in the format
--         BB-YYYYMMDD-XXXX   (X = 4 random hex chars, e.g. BB-20250612-9F3A)
--       so two orders on the same day can never collide for practical
--       purposes while staying human-friendly. Money columns are snapshots;
--       line items keep their own copies so later catalog edits never
--       rewrite history.
-- -----------------------------------------------------------------------------
create table if not exists public.orders (
  id               uuid primary key default gen_random_uuid(),
  order_number     text not null unique
                   default ('BB-' || to_char(now(),'YYYYMMDD') || '-'
                            || upper(substr(replace(gen_random_uuid()::text,'-',''),1,4))),
  customer_name    text not null,
  phone            text not null,
  email            text,
  fulfillment_type text not null default 'pickup',
  delivery_address text,                                  -- required when fulfillment_type = 'delivery'
  requested_date   date,                                  -- desired pickup/delivery date
  requested_time   text,                                  -- time slot, e.g. '10:00'
  notes            text,
  subtotal         numeric(10,2) not null default 0,
  delivery_fee     numeric(10,2) not null default 0,
  total            numeric(10,2) not null default 0,
  currency         text not null default 'USD',
  status           text not null default 'pending',
  whatsapp_sent    boolean not null default false,        -- set by admin after sending a confirm message
  is_demo          boolean not null default false,
  demo_batch_id    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint orders_fulfillment_type_valid check (fulfillment_type in ('pickup','delivery')),
  constraint orders_status_valid           check (status in ('pending','confirmed','preparing','ready','completed','cancelled')),
  constraint orders_subtotal_non_negative  check (subtotal >= 0),
  constraint orders_delivery_fee_non_negative check (delivery_fee >= 0),
  constraint orders_total_non_negative     check (total >= 0)
);

comment on table public.orders is 'Customer orders. Anon can INSERT only (RLS); admins read/update via the admin panel.';

-- -----------------------------------------------------------------------------
-- 03.g  order_items — line items of an order
--       product_name / unit_price / selected_options are SNAPSHOTS taken at
--       purchase time. product_id uses ON DELETE SET NULL so removing a
--       product (or running remove_demo_catalog) never destroys order
--       history — the item keeps its name and price.
-- -----------------------------------------------------------------------------
create table if not exists public.order_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.orders (id) on delete cascade,
  product_id       uuid references public.products (id) on delete set null,
  product_name     text not null,                         -- snapshot
  unit_price       numeric(10,2) not null,                -- snapshot (product price + option deltas)
  quantity         integer not null,
  selected_options jsonb not null default '[]'::jsonb,    -- [{name,label,price_delta}]
  line_total       numeric(10,2) not null,
  created_at       timestamptz not null default now(),

  constraint order_items_quantity_positive check (quantity > 0),
  constraint order_items_unit_price_non_negative check (unit_price >= 0),
  constraint order_items_line_total_non_negative check (line_total >= 0)
);

comment on table public.order_items is 'Order line items with price/name snapshots; survives product deletion via ON DELETE SET NULL.';

-- -----------------------------------------------------------------------------
-- 03.h  cake_requests — "Design your cake" form submissions
--       estimated_price is what the site calculator showed (an estimate only);
--       admin_notes is the internal back-office scratchpad.
-- -----------------------------------------------------------------------------
create table if not exists public.cake_requests (
  id                  uuid primary key default gen_random_uuid(),
  customer_name       text not null,
  phone               text not null,
  email               text,
  cake_type           text,                               -- Layer Cake, Sheet Cake, Cupcake Tower, Tiered Cake, Other
  flavor              text,                               -- Vanilla, Chocolate, Red Velvet, Lemon, Carrot, Custom
  size_label          text,                               -- matches settings.custom_cake_sizes[].label
  filling             text,
  frosting_type       text,                               -- Buttercream, Cream cheese, Ganache, Fondant
  frosting_color      text,
  decoration_style    text,                               -- Minimalist/Floral/Birthday/Themed/Wedding/Custom
  message_on_cake     text,                               -- max 40 chars, enforced client-side
  fulfillment_type    text,                               -- pickup / delivery
  requested_date      date,
  preferred_time      text,
  budget_range        text,                               -- '$30-50' ... '$200+'
  allergies           text,
  special_instructions text,
  reference_image_url text,                               -- public URL of the upload in cake-references/uploads/
  estimated_price     numeric(10,2),                      -- site-side estimate, null if not calculated
  status              text not null default 'pending',
  admin_notes         text,
  is_demo             boolean not null default false,
  demo_batch_id       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint cake_requests_fulfillment_type_valid check (fulfillment_type in ('pickup','delivery')),
  constraint cake_requests_status_valid           check (status in ('pending','accepted','rejected','completed','cancelled')),
  constraint cake_requests_price_non_negative     check (estimated_price is null or estimated_price >= 0)
);

comment on table public.cake_requests is 'Custom cake enquiries from the custom-cake page; admins triage via status + admin_notes.';

-- -----------------------------------------------------------------------------
-- 03.i  reservations — tastings, workshops, private events, tables
-- -----------------------------------------------------------------------------
create table if not exists public.reservations (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  phone            text not null,
  email            text,
  reservation_type text not null,
  party_size       integer,
  requested_date   date,
  requested_time   text,
  notes            text,
  status           text not null default 'pending',
  admin_notes      text,
  is_demo          boolean not null default false,
  demo_batch_id    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint reservations_type_valid   check (reservation_type in ('tasting','workshop','event','table')),
  constraint reservations_status_valid check (status in ('pending','accepted','rejected','completed','cancelled')),
  constraint reservations_party_size_positive check (party_size is null or party_size > 0)
);

comment on table public.reservations is 'Reservation requests (tasting/workshop/event/table) submitted from reservations.html.';

-- -----------------------------------------------------------------------------
-- 03.j  contact_messages — contact form inbox
-- -----------------------------------------------------------------------------
create table if not exists public.contact_messages (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  email      text not null,
  phone      text,
  subject    text,                                        -- General / Custom cake / Catering / Feedback
  message    text not null,
  is_read    boolean not null default false,              -- admin "mark as read"
  is_demo    boolean not null default false,
  demo_batch_id text,
  created_at timestamptz not null default now()
);

comment on table public.contact_messages is 'Contact form submissions; admin marks them read / deletes after handling.';

-- -----------------------------------------------------------------------------
-- 03.k  site_settings — ONE row (id = 1) holding every editable site-wide value
--       jsonb array shapes:
--         opening_hours       [{"label":"Monday","hours":"8:00 - 18:00"}, ...]
--         custom_cake_sizes   [{"label":"6 inch — serves 8","price":38}, ...]
--         custom_cake_extras  [{"label":"Floral","price":15}, ...]
--       The check pins the table to a single row; the admin Settings page
--       upserts id = 1.
-- -----------------------------------------------------------------------------
create table if not exists public.site_settings (
  id                  integer primary key default 1,
  bakery_name         text,
  tagline             text,
  hero_title          text,                               -- script-font home page headline
  hero_subtitle       text,
  hero_image          text,                               -- './hero-croissants.jpg'
  hero_cta_label      text,                               -- e.g. 'Order Now'
  announcement_text   text,
  announcement_enabled boolean not null default false,
  currency_code       text not null default 'USD',
  currency_symbol     text not null default '$',
  whatsapp_number     text,                               -- digits only, used for wa.me links
  phone               text,
  email               text,
  address             text,
  opening_hours       jsonb not null default '[]'::jsonb,
  instagram_url       text,
  facebook_url        text,
  tiktok_url          text,
  pickup_enabled      boolean not null default true,
  delivery_enabled    boolean not null default true,
  delivery_fee        numeric(10,2) not null default 0,
  delivery_free_over  numeric(10,2),                      -- free delivery threshold; null = never free
  min_order_amount    numeric(10,2) not null default 0,
  about_title         text,
  about_text          text,
  custom_cake_note    text,                               -- disclaimer under the cake price estimate
  custom_cake_sizes   jsonb not null default '[]'::jsonb,
  custom_cake_extras  jsonb not null default '[]'::jsonb,
  policy_note         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint site_settings_single_row check (id = 1)
);

comment on table public.site_settings is 'Single row (id=1) with all site-wide content, hours, socials, currency and delivery rules.';

-- -----------------------------------------------------------------------------
-- 03.l  testimonials — quotes shown on the home page
-- -----------------------------------------------------------------------------
create table if not exists public.testimonials (
  id           uuid primary key default gen_random_uuid(),
  author       text not null,
  quote        text not null,
  rating       integer not null default 5,
  is_published boolean not null default true,
  is_demo      boolean not null default false,
  demo_batch_id text,
  created_at   timestamptz not null default now(),

  constraint testimonials_rating_range check (rating between 1 and 5)
);

comment on table public.testimonials is 'Customer quotes for the home page; demo rows are clearly labelled on the site.';


-- =============================================================================
-- 04 · INDEXES
-- -----------------------------------------------------------------------------
-- Kept deliberately small: every index below matches a query the site actually
-- runs (shop filters, admin lists, demo cleanup). Unique columns (slugs,
-- order_number) are already indexed by their UNIQUE constraints.
-- =============================================================================

-- Shop page: filter by category, restrict to published, sort by price.
create index if not exists idx_products_category_id   on public.products (category_id);
create index if not exists idx_products_is_published  on public.products (is_published);
create index if not exists idx_products_price         on public.products (price);

-- Gallery + options lookup per product (also speeds ON DELETE CASCADE).
create index if not exists idx_product_images_product_id  on public.product_images (product_id);
create index if not exists idx_product_options_product_id on public.product_options (product_id);

-- "Shop the collection" filter uses seasonal_collections @> '{slug}'.
create index if not exists idx_products_seasonal_collections_gin
  on public.products using gin (seasonal_collections);

-- Admin orders list: filter by status, newest first.
create index if not exists idx_order_items_order_id   on public.order_items (order_id);
create index if not exists idx_order_items_product_id on public.order_items (product_id);  -- speeds ON DELETE SET NULL
create index if not exists idx_orders_status          on public.orders (status);
create index if not exists idx_orders_created_at_desc on public.orders (created_at desc);

-- Admin triage lists.
create index if not exists idx_cake_requests_status       on public.cake_requests (status);
create index if not exists idx_reservations_requested_date on public.reservations (requested_date);

-- Fast idempotency check inside load_demo_catalog() (partial: only demo rows).
create index if not exists idx_products_demo_batch on public.products (demo_batch_id)
  where is_demo = true;


-- =============================================================================
-- 05 · UPDATED_AT TRIGGERS
-- -----------------------------------------------------------------------------
-- Applied to the seven tables that are edited over their lifetime. Tables
-- without updated_at by design: product_images, product_options (recreated on
-- edit), order_items (immutable snapshots), contact_messages, testimonials.
-- =============================================================================

drop trigger if exists trg_categories_updated_at on public.categories;
create trigger trg_categories_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

drop trigger if exists trg_collections_updated_at on public.collections;
create trigger trg_collections_updated_at
  before update on public.collections
  for each row execute function public.set_updated_at();

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

drop trigger if exists trg_cake_requests_updated_at on public.cake_requests;
create trigger trg_cake_requests_updated_at
  before update on public.cake_requests
  for each row execute function public.set_updated_at();

drop trigger if exists trg_reservations_updated_at on public.reservations;
create trigger trg_reservations_updated_at
  before update on public.reservations
  for each row execute function public.set_updated_at();

drop trigger if exists trg_site_settings_updated_at on public.site_settings;
create trigger trg_site_settings_updated_at
  before update on public.site_settings
  for each row execute function public.set_updated_at();


-- =============================================================================
-- 06 · ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
-- ACCESS MODEL (spec section 4)
--   anon (public visitors):
--     · SELECT on the published/active catalog (products, images, options,
--       categories, collections, testimonials) and on site_settings.
--     · INSERT-only on orders, order_items, cake_requests, reservations and
--       contact_messages (the public forms). WITH CHECK (true) and NO
--       anon SELECT/UPDATE/DELETE — visitors can submit, but only admins
--       can read submissions back.
--   authenticated (bakery admins, no public sign-up):
--     · Full access (select/insert/update/delete) on every table, expressed
--       as separate per-command policies so each can be tuned or audited
--       individually. SELECT is unfiltered so admins can see drafts,
--       unpublished rows and submissions.
--   service_role:
--     · Bypasses RLS entirely (Supabase server-side convention); policies
--       intentionally omit it.
--
-- Tables without explicit anon policies (e.g. no anon SELECT on orders) are
-- fully locked for anon thanks to RLS being ENABLED with no permissive
-- policy — Postgres denies by default under RLS.
-- =============================================================================

alter table public.categories        enable row level security;
alter table public.collections       enable row level security;
alter table public.products          enable row level security;
alter table public.product_images    enable row level security;
alter table public.product_options   enable row level security;
alter table public.orders            enable row level security;
alter table public.order_items       enable row level security;
alter table public.cake_requests     enable row level security;
alter table public.reservations      enable row level security;
alter table public.contact_messages  enable row level security;
alter table public.site_settings     enable row level security;
alter table public.testimonials      enable row level security;

-- Table privileges. Supabase grants these by default for new public tables;
-- repeating them here keeps the schema self-contained even if the project's
-- default privileges were changed. RLS remains the real gate.
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;

-- ----------------------------------------------------------------- categories
-- Public: only active categories. Admin: everything.
drop policy if exists "categories_public_read_active" on public.categories;
create policy "categories_public_read_active"
  on public.categories for select
  to anon
  using (is_active = true);

drop policy if exists "categories_authenticated_select" on public.categories;
create policy "categories_authenticated_select"
  on public.categories for select
  to authenticated
  using (true);

drop policy if exists "categories_authenticated_insert" on public.categories;
create policy "categories_authenticated_insert"
  on public.categories for insert
  to authenticated
  with check (true);

drop policy if exists "categories_authenticated_update" on public.categories;
create policy "categories_authenticated_update"
  on public.categories for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "categories_authenticated_delete" on public.categories;
create policy "categories_authenticated_delete"
  on public.categories for delete
  to authenticated
  using (true);

-- ---------------------------------------------------------------- collections
drop policy if exists "collections_public_read_active" on public.collections;
create policy "collections_public_read_active"
  on public.collections for select
  to anon
  using (is_active = true);

drop policy if exists "collections_authenticated_select" on public.collections;
create policy "collections_authenticated_select"
  on public.collections for select
  to authenticated
  using (true);

drop policy if exists "collections_authenticated_insert" on public.collections;
create policy "collections_authenticated_insert"
  on public.collections for insert
  to authenticated
  with check (true);

drop policy if exists "collections_authenticated_update" on public.collections;
create policy "collections_authenticated_update"
  on public.collections for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "collections_authenticated_delete" on public.collections;
create policy "collections_authenticated_delete"
  on public.collections for delete
  to authenticated
  using (true);

-- ------------------------------------------------------------------- products
-- Public: published products only. Admin: everything (drafts included).
drop policy if exists "products_public_read_published" on public.products;
create policy "products_public_read_published"
  on public.products for select
  to anon
  using (is_published = true);

drop policy if exists "products_authenticated_select" on public.products;
create policy "products_authenticated_select"
  on public.products for select
  to authenticated
  using (true);

drop policy if exists "products_authenticated_insert" on public.products;
create policy "products_authenticated_insert"
  on public.products for insert
  to authenticated
  with check (true);

drop policy if exists "products_authenticated_update" on public.products;
create policy "products_authenticated_update"
  on public.products for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "products_authenticated_delete" on public.products;
create policy "products_authenticated_delete"
  on public.products for delete
  to authenticated
  using (true);

-- ------------------------------------------------------------- product_images
-- Public: an image is visible when its PARENT PRODUCT is published (EXISTS
-- subquery — RLS on products also applies inside the subquery, so drafts stay
-- fully hidden). Admin: unrestricted.
drop policy if exists "product_images_public_read_of_published" on public.product_images;
create policy "product_images_public_read_of_published"
  on public.product_images for select
  to anon
  using (
    exists (
      select 1
      from public.products p
      where p.id = product_id
        and p.is_published = true
    )
  );

drop policy if exists "product_images_authenticated_select" on public.product_images;
create policy "product_images_authenticated_select"
  on public.product_images for select
  to authenticated
  using (true);

drop policy if exists "product_images_authenticated_insert" on public.product_images;
create policy "product_images_authenticated_insert"
  on public.product_images for insert
  to authenticated
  with check (true);

drop policy if exists "product_images_authenticated_update" on public.product_images;
create policy "product_images_authenticated_update"
  on public.product_images for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "product_images_authenticated_delete" on public.product_images;
create policy "product_images_authenticated_delete"
  on public.product_images for delete
  to authenticated
  using (true);

-- ------------------------------------------------------------ product_options
drop policy if exists "product_options_public_read_of_published" on public.product_options;
create policy "product_options_public_read_of_published"
  on public.product_options for select
  to anon
  using (
    exists (
      select 1
      from public.products p
      where p.id = product_id
        and p.is_published = true
    )
  );

drop policy if exists "product_options_authenticated_select" on public.product_options;
create policy "product_options_authenticated_select"
  on public.product_options for select
  to authenticated
  using (true);

drop policy if exists "product_options_authenticated_insert" on public.product_options;
create policy "product_options_authenticated_insert"
  on public.product_options for insert
  to authenticated
  with check (true);

drop policy if exists "product_options_authenticated_update" on public.product_options;
create policy "product_options_authenticated_update"
  on public.product_options for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "product_options_authenticated_delete" on public.product_options;
create policy "product_options_authenticated_delete"
  on public.product_options for delete
  to authenticated
  using (true);

-- --------------------------------------------------------------------- orders
-- Anon: INSERT only (checkout). No anon SELECT/UPDATE/DELETE — absence of a
-- policy means deny under RLS. Admin: full access.
drop policy if exists "orders_anon_insert_only" on public.orders;
create policy "orders_anon_insert_only"
  on public.orders for insert
  to anon
  with check (true);

drop policy if exists "orders_authenticated_select" on public.orders;
create policy "orders_authenticated_select"
  on public.orders for select
  to authenticated
  using (true);

drop policy if exists "orders_authenticated_insert" on public.orders;
create policy "orders_authenticated_insert"
  on public.orders for insert
  to authenticated
  with check (true);

drop policy if exists "orders_authenticated_update" on public.orders;
create policy "orders_authenticated_update"
  on public.orders for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "orders_authenticated_delete" on public.orders;
create policy "orders_authenticated_delete"
  on public.orders for delete
  to authenticated
  using (true);

-- ---------------------------------------------------------------- order_items
drop policy if exists "order_items_anon_insert_only" on public.order_items;
create policy "order_items_anon_insert_only"
  on public.order_items for insert
  to anon
  with check (true);

drop policy if exists "order_items_authenticated_select" on public.order_items;
create policy "order_items_authenticated_select"
  on public.order_items for select
  to authenticated
  using (true);

drop policy if exists "order_items_authenticated_insert" on public.order_items;
create policy "order_items_authenticated_insert"
  on public.order_items for insert
  to authenticated
  with check (true);

drop policy if exists "order_items_authenticated_update" on public.order_items;
create policy "order_items_authenticated_update"
  on public.order_items for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "order_items_authenticated_delete" on public.order_items;
create policy "order_items_authenticated_delete"
  on public.order_items for delete
  to authenticated
  using (true);

-- -------------------------------------------------------------- cake_requests
drop policy if exists "cake_requests_anon_insert_only" on public.cake_requests;
create policy "cake_requests_anon_insert_only"
  on public.cake_requests for insert
  to anon
  with check (true);

drop policy if exists "cake_requests_authenticated_select" on public.cake_requests;
create policy "cake_requests_authenticated_select"
  on public.cake_requests for select
  to authenticated
  using (true);

drop policy if exists "cake_requests_authenticated_insert" on public.cake_requests;
create policy "cake_requests_authenticated_insert"
  on public.cake_requests for insert
  to authenticated
  with check (true);

drop policy if exists "cake_requests_authenticated_update" on public.cake_requests;
create policy "cake_requests_authenticated_update"
  on public.cake_requests for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "cake_requests_authenticated_delete" on public.cake_requests;
create policy "cake_requests_authenticated_delete"
  on public.cake_requests for delete
  to authenticated
  using (true);

-- --------------------------------------------------------------- reservations
drop policy if exists "reservations_anon_insert_only" on public.reservations;
create policy "reservations_anon_insert_only"
  on public.reservations for insert
  to anon
  with check (true);

drop policy if exists "reservations_authenticated_select" on public.reservations;
create policy "reservations_authenticated_select"
  on public.reservations for select
  to authenticated
  using (true);

drop policy if exists "reservations_authenticated_insert" on public.reservations;
create policy "reservations_authenticated_insert"
  on public.reservations for insert
  to authenticated
  with check (true);

drop policy if exists "reservations_authenticated_update" on public.reservations;
create policy "reservations_authenticated_update"
  on public.reservations for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "reservations_authenticated_delete" on public.reservations;
create policy "reservations_authenticated_delete"
  on public.reservations for delete
  to authenticated
  using (true);

-- ------------------------------------------------------------ contact_messages
drop policy if exists "contact_messages_anon_insert_only" on public.contact_messages;
create policy "contact_messages_anon_insert_only"
  on public.contact_messages for insert
  to anon
  with check (true);

drop policy if exists "contact_messages_authenticated_select" on public.contact_messages;
create policy "contact_messages_authenticated_select"
  on public.contact_messages for select
  to authenticated
  using (true);

drop policy if exists "contact_messages_authenticated_insert" on public.contact_messages;
create policy "contact_messages_authenticated_insert"
  on public.contact_messages for insert
  to authenticated
  with check (true);

drop policy if exists "contact_messages_authenticated_update" on public.contact_messages;
create policy "contact_messages_authenticated_update"
  on public.contact_messages for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "contact_messages_authenticated_delete" on public.contact_messages;
create policy "contact_messages_authenticated_delete"
  on public.contact_messages for delete
  to authenticated
  using (true);

-- --------------------------------------------------------------- site_settings
-- The single settings row is readable by EVERYONE (the public site renders
-- hours, socials, currency, delivery rules from it). Writes are admin-only.
drop policy if exists "site_settings_public_read" on public.site_settings;
create policy "site_settings_public_read"
  on public.site_settings for select
  to anon, authenticated
  using (true);

drop policy if exists "site_settings_authenticated_insert" on public.site_settings;
create policy "site_settings_authenticated_insert"
  on public.site_settings for insert
  to authenticated
  with check (true);

drop policy if exists "site_settings_authenticated_update" on public.site_settings;
create policy "site_settings_authenticated_update"
  on public.site_settings for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "site_settings_authenticated_delete" on public.site_settings;
create policy "site_settings_authenticated_delete"
  on public.site_settings for delete
  to authenticated
  using (true);

-- ---------------------------------------------------------------- testimonials
drop policy if exists "testimonials_public_read_published" on public.testimonials;
create policy "testimonials_public_read_published"
  on public.testimonials for select
  to anon
  using (is_published = true);

drop policy if exists "testimonials_authenticated_select" on public.testimonials;
create policy "testimonials_authenticated_select"
  on public.testimonials for select
  to authenticated
  using (true);

drop policy if exists "testimonials_authenticated_insert" on public.testimonials;
create policy "testimonials_authenticated_insert"
  on public.testimonials for insert
  to authenticated
  with check (true);

drop policy if exists "testimonials_authenticated_update" on public.testimonials;
create policy "testimonials_authenticated_update"
  on public.testimonials for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "testimonials_authenticated_delete" on public.testimonials;
create policy "testimonials_authenticated_delete"
  on public.testimonials for delete
  to authenticated
  using (true);


-- =============================================================================
-- 07 · STORAGE
-- -----------------------------------------------------------------------------
-- Two public buckets (created only if missing — re-runs leave existing bucket
-- settings untouched thanks to on conflict do nothing):
--   product-images   — product + category + collection photos, uploaded by the
--                      admin panel (BB.uploadImage).
--   cake-references  — inspiration photos attached to custom cake requests.
--                      Visitors (anon) may upload ONLY into the uploads/
--                      folder; admins manage the rest.
-- Bucket objects are publicly readable via their public URLs; the SELECT
-- policies below mirror that for the Storage API.
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('cake-references', 'cake-references', true)
on conflict (id) do nothing;

-- -------------------------------------------------------------- product-images
drop policy if exists "product-images public read" on storage.objects;
create policy "product-images public read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'product-images');

drop policy if exists "product-images authenticated upload" on storage.objects;
create policy "product-images authenticated upload"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'product-images');

drop policy if exists "product-images authenticated update" on storage.objects;
create policy "product-images authenticated update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'product-images');

drop policy if exists "product-images authenticated delete" on storage.objects;
create policy "product-images authenticated delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'product-images');

-- ------------------------------------------------------------- cake-references
drop policy if exists "cake-references public read" on storage.objects;
create policy "cake-references public read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'cake-references');

-- Visitors may only drop files into uploads/ (storage.foldername(name)[1] is
-- the first path segment of the object name).
drop policy if exists "cake-references anon upload to uploads folder" on storage.objects;
create policy "cake-references anon upload to uploads folder"
  on storage.objects for insert
  to anon
  with check (
    bucket_id = 'cake-references'
    and (storage.foldername(name))[1] = 'uploads'
  );

drop policy if exists "cake-references authenticated update" on storage.objects;
create policy "cake-references authenticated update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'cake-references');

drop policy if exists "cake-references authenticated delete" on storage.objects;
create policy "cake-references authenticated delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'cake-references');


-- =============================================================================
-- 08 · DEMO DATA FUNCTIONS (admin-only, SECURITY DEFINER)
-- -----------------------------------------------------------------------------
-- load_demo_catalog()   idempotent one-call seed of the entire demo catalog
--                       from spec section 5: 10 categories, 5 collections,
--                       30 products (+ cover images, + options), the
--                       site_settings row (warm defaults) and 3 testimonials.
--                       Every inserted row is tagged is_demo = true and
--                       demo_batch_id = 'bb-demo-v1'.
--                       Re-running (or re-pressing "Load" in the admin panel)
--                       is a no-op that returns {"loaded":0,"skipped":true}.
--                       The site_settings row uses ON CONFLICT DO NOTHING so
--                       admin customizations always survive.
--
-- remove_demo_catalog() deletes ONLY rows where is_demo = true AND
--                       demo_batch_id = 'bb-demo-v1'. Product images/options
--                       disappear via ON DELETE CASCADE; demo orders, cake
--                       requests, reservations and contact messages are also
--                       cleared in case demo-flagged records were ever
--                       created. Anything you built yourself is never touched.
--
-- Both run as SECURITY DEFINER (owner = postgres, which bypasses RLS as table
-- owner), so they work even though anon/authenticated RLS would otherwise
-- restrict bulk writes. EXECUTE is revoked from anon/public and granted to
-- authenticated (+ service_role) — demo management is admin-only.
--
-- NOTE ON THE SPEC'S "seasonal" FLAG: the products table has no is_seasonal
-- column by design. Products flagged "seasonal" in the spec (Valentine
-- cupcakes, pumpkin rolls, gingerbread) are expressed through their
-- seasonal_collections membership (valentines / holiday), which is exactly
-- how the site surfaces them (collections.html + shop.html?collection=...).
-- =============================================================================

create or replace function public.load_demo_catalog()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_category_count    integer := 0;
  v_collection_count  integer := 0;
  v_product_count     integer := 0;
  v_testimonial_count integer := 0;
begin
  -- ----------------------------------------------------------- idempotency gate
  -- If any demo row of the current batch already exists, do nothing. This also
  -- protects unique slugs from a partially-loaded state.
  if exists (select 1 from public.products     where demo_batch_id = 'bb-demo-v1')
      or exists (select 1 from public.categories  where demo_batch_id = 'bb-demo-v1')
      or exists (select 1 from public.collections where demo_batch_id = 'bb-demo-v1') then
    return jsonb_build_object(
      'loaded',  0,
      'skipped', true,
      'message', 'Demo data already loaded'
    );
  end if;

  -- ------------------------------------------------------------------ categories
  -- If a category with the same slug was created by an admin beforehand, the
  -- insert skips it (on conflict do nothing) and products below simply attach
  -- to the existing row — graceful degradation instead of a hard error.
  -- @demo-categories
  insert into public.categories
    (slug, name, description, image_url, sort_order, is_active, is_demo, demo_batch_id, created_at)
  select
    d.slug, d.name, d.description, d.image_url, d.sort_order, true, true, 'bb-demo-v1', d.created_at
  from (values
    ('cakes',      'Cakes',      'Layer cakes, celebration tiers and teatime sponges — the heart of the bakery.',                 './vanilla-bean-cake.jpg',       1, '2025-08-01 08:00:00+00'::timestamptz),
    ('cupcakes',   'Cupcakes',   'Swirled, decorated and boxed by the six — little cakes with big personalities.',                './chocolate-cupcakes.jpg',      2, '2025-08-01 08:00:00+00'::timestamptz),
    ('croissants', 'Croissants', 'Hand-laminated all-butter viennoiserie, baked at 8:00 every baking morning.',                   './butter-croissants.jpg',       3, '2025-08-01 08:00:00+00'::timestamptz),
    ('pastries',   'Pastries',   'Cinnamon rolls, danishes and fruit tarts, made in small trays through the morning.',            './cinnamon-rolls.jpg',          4, '2025-08-01 08:00:00+00'::timestamptz),
    ('cookies',    'Cookies',    'Thick, chewy and generously filled — cookies worth writing home about.',                        './chocolate-chip-cookies.jpg',  5, '2025-08-01 08:00:00+00'::timestamptz),
    ('donuts',     'Donuts',     'Featherlight brioche donuts, dipped, drizzled and topped by hand.',                             './glazed-donuts.jpg',           6, '2025-08-01 08:00:00+00'::timestamptz),
    ('macarons',   'Macarons',   'Delicate almond shells with silky ganache fillings, boxed to give or to keep.',                 './macarons-pink.jpg',           7, '2025-08-01 08:00:00+00'::timestamptz),
    ('bread',      'Bread',      'Slow-fermented sourdough, enriched brioche and rustic rosemary focaccia.',                      './artisan-sourdough.jpg',       8, '2025-08-01 08:00:00+00'::timestamptz),
    ('muffins',    'Muffins',    'Bakery-style muffins with domed sugared tops, baked fresh every morning.',                      './blueberry-muffins.jpg',       9, '2025-08-01 08:00:00+00'::timestamptz),
    ('seasonal',   'Seasonal',   'Limited bakes for the season — gingerbread, warm spice and everything festive.',                './gingerbread-cookies.jpg',    10, '2025-08-01 08:00:00+00'::timestamptz)
  ) as d(slug, name, description, image_url, sort_order, created_at)
  on conflict (slug) do nothing;
  get diagnostics v_category_count = row_count;

  -- ----------------------------------------------------------------- collections
  -- @demo-collections
  insert into public.collections
    (slug, name, description, image_url, sort_order, is_active, is_demo, demo_batch_id, created_at)
  select
    d.slug, d.name, d.description, d.image_url, d.sort_order, true, true, 'bb-demo-v1', d.created_at
  from (values
    ('valentines',  'Valentines',     'Blush hearts, rose macarons and berry bakes for love letters and February tables.',  './collection-valentines.jpg',  1, '2025-08-01 08:00:00+00'::timestamptz),
    ('mothers-day', 'Mothers Day',    'Pastel blossoms, lemon and vanilla — gentle bakes for the ones who deserve cake most.', './collection-mothers-day.jpg', 2, '2025-08-01 08:00:00+00'::timestamptz),
    ('birthday',    'Birthday',       'Candles welcome. Celebration cakes, cupcakes and party boxes for the big day.',       './collection-birthday.jpg',    3, '2025-08-01 08:00:00+00'::timestamptz),
    ('wedding',     'Wedding',        'Tiered cakes, macaron towers and dessert tables for the day you never forget.',       './collection-wedding.jpg',     4, '2025-08-01 08:00:00+00'::timestamptz),
    ('holiday',     'Holiday',        'Gingerbread, warm spice and winter sweetness — our coziest bakes of the year.',       './collection-holiday.jpg',     5, '2025-08-01 08:00:00+00'::timestamptz)
  ) as d(slug, name, description, image_url, sort_order, created_at)
  on conflict (slug) do nothing;
  get diagnostics v_collection_count = row_count;

  -- -------------------------------------------------------------------- products
  -- 30 products in the exact spec order and with the exact flags.
  -- Values rows carry: slug, name, short_description, description, category
  -- slug, price, compare_at_price, featured, best seller, new, collection
  -- slugs, ingredients, allergens, servings_info, created_at.
  -- is_available / is_published / is_visible are true for every demo product;
  -- the spec's "seasonal" flag is carried by seasonal_collections membership.
  -- Staggered created_at values keep the "Newest" sort deterministic, with
  -- is_new products stamped most recently.
  -- @demo-products
  insert into public.products
    (slug, name, short_description, description, category_id, price, compare_at_price,
     is_available, is_published, is_visible, is_featured, is_best_seller, is_new,
     seasonal_collections, ingredients, allergens, servings_info, is_demo, demo_batch_id, created_at)
  select
    d.slug, d.name, d.short_description, d.description, c.id, d.price, d.compare_at_price,
    true, true, true, d.is_featured, d.is_best_seller, d.is_new,
    d.seasonal_collections, d.ingredients, d.allergens, d.servings_info, true, 'bb-demo-v1', d.created_at
  from (values
    ('vanilla-bean-celebration-cake', 'Vanilla Bean Celebration Cake', 'Four soft vanilla layers with Madagascar bean buttercream and white chocolate shards.', 'Our signature celebration cake, layered with hand-scraped vanilla bean buttercream and a gentle vanilla syrup. Finished with white chocolate shards and dried blossoms. The cake that started half the birthday traditions in town.', 'cakes', 42.00, null::numeric, true, false, false, '{}'::text[], 'Wheat flour, cane sugar, butter, free-range eggs, whole milk, Madagascar vanilla bean, white chocolate, baking powder, sea salt.', 'Contains gluten, dairy, eggs. Made in a kitchen that also handles nuts.', '6 inch, serves 8-10. Keeps 3 days refrigerated; best at room temperature.', '2025-10-01 08:00:00+00'::timestamptz),
    ('midnight-chocolate-truffle-cake', 'Midnight Chocolate Truffle Cake', 'Deep dark chocolate layers, glossy ganache drip and a crowning of chocolate curls.', 'Three layers of midnight-dark chocolate sponge, filled with whipped ganache and covered in a glossy semisweet drip. Topped with hand-rolled truffles and chocolate curls. Intensely chocolatey without ever feeling heavy.', 'cakes', 48.00, 54.00, true, true, false, '{birthday}'::text[], 'Wheat flour, cane sugar, dark chocolate, cocoa powder, butter, eggs, cream, vanilla, sea salt.', 'Contains gluten, dairy, eggs, soya. May contain traces of nuts.', '8 inch, serves 12-14. Keeps 3 days refrigerated.', '2025-10-02 08:00:00+00'::timestamptz),
    ('red-velvet-dream-cake', 'Red Velvet Dream Cake', 'Velvety crimson layers with tangy cream cheese frosting and red velvet crumble.', 'A classic done properly: buttermilk red velvet layers with a hint of cocoa, stacked tall with silky cream cheese frosting and finished with a crown of red velvet crumble. Our most requested cake three years running.', 'cakes', 45.00, null::numeric, false, true, false, '{}'::text[], 'Wheat flour, buttermilk, cane sugar, butter, eggs, cocoa powder, cream cheese, icing sugar, vanilla, beetroot powder.', 'Contains gluten, dairy, eggs.', '8 inch, serves 12. Keeps 3 days refrigerated.', '2025-10-03 08:00:00+00'::timestamptz),
    ('lemon-rosemary-olive-oil-cake', 'Lemon Rosemary Olive Oil Cake', 'Fragrant olive oil sponge with lemon glaze, candied lemon and fresh rosemary.', 'Golden olive oil sponge soaked with lemon syrup and crowned with candied lemon slices and tiny rosemary sprigs. The olive oil keeps it impossibly moist, with a gentle peppery finish. A sunny, grown-up cake for slow afternoons.', 'cakes', 38.00, null::numeric, false, false, true, '{mothers-day}'::text[], 'Wheat flour, cane sugar, extra virgin olive oil, free-range eggs, lemons, fresh rosemary, baking powder, sea salt.', 'Contains gluten, eggs.', '8 inch, serves 10. Keeps 4 days in an airtight tin.', '2025-11-18 08:00:00+00'::timestamptz),
    ('spiced-carrot-walnut-cake', 'Spiced Carrot Walnut Cake', 'Warmly spiced carrot sponge, toasted walnuts and whipped cream cheese frosting.', 'Grated carrot, cinnamon and a pinch of cardamom folded into a moist sponge with plenty of toasted walnuts. Frosted with whipped cream cheese and finished with tiny marzipan carrots. Comfort in cake form.', 'cakes', 36.00, null::numeric, false, false, false, '{}'::text[], 'Wheat flour, carrots, cane sugar, walnuts, eggs, butter, cream cheese, cinnamon, cardamom, baking soda, sea salt.', 'Contains gluten, dairy, eggs, walnuts.', '8 inch, serves 12. Keeps 4 days refrigerated.', '2025-10-05 08:00:00+00'::timestamptz),
    ('garden-wedding-cake', 'Garden Wedding Cake', 'Three airy vanilla tiers with ivory buttercream and blush sugar flowers.', 'Three light vanilla tiers filled with vanilla bean cream and strawberry compote, dressed in smooth ivory buttercream. Hand-piped blush sugar flowers cascade down one side. Designed with you, baked for your day.', 'cakes', 220.00, null::numeric, true, false, false, '{wedding}'::text[], 'Wheat flour, cane sugar, butter, eggs, cream, strawberries, vanilla bean, icing sugar, sugar flowers.', 'Contains gluten, dairy, eggs.', 'Three tiers (6, 8 and 10 inch), serves 60-70. Collection recommended; delivered chilled.', '2025-10-06 08:00:00+00'::timestamptz),
    ('salted-caramel-chocolate-cupcakes', 'Salted Caramel Chocolate Cupcakes', 'Fudgy chocolate cupcakes with salted caramel buttercream and a caramel drizzle.', 'Fudgy chocolate cupcakes crowned with swirled salted caramel buttercream. Each one finished with a drizzle of house caramel and a pinch of flaky sea salt. Sold in packs of six.', 'cupcakes', 24.00, null::numeric, false, true, false, '{birthday}'::text[], 'Wheat flour, cane sugar, cocoa powder, butter, eggs, milk, cream, caramel, icing sugar, sea salt.', 'Contains gluten, dairy, eggs.', 'Box of 6. Best enjoyed within 2 days.', '2025-10-07 08:00:00+00'::timestamptz),
    ('vanilla-blossom-berry-cupcakes', 'Vanilla Blossom Berry Cupcakes', 'Vanilla cupcakes with raspberry buttercream, fresh berries and tiny blossoms.', 'Light vanilla cupcakes topped with swirls of raspberry buttercream, a fresh raspberry and delicate white blossoms. Spring on a cake stand. Sold in packs of six.', 'cupcakes', 26.00, null::numeric, false, false, true, '{mothers-day}'::text[], 'Wheat flour, cane sugar, butter, eggs, milk, raspberries, icing sugar, vanilla.', 'Contains gluten, dairy, eggs.', 'Box of 6. Best enjoyed within 2 days.', '2025-11-17 08:00:00+00'::timestamptz),
    ('red-velvet-crumble-cupcakes', 'Red Velvet Crumble Cupcakes', 'Red velvet cupcakes with tangy cream cheese frosting and crumble topping.', 'Our red velvet cake in cupcake form, topped with tangy cream cheese frosting and a generous sprinkle of red velvet crumble. Deep red, softly cocoa, endlessly popular. Sold in packs of six.', 'cupcakes', 24.00, null::numeric, false, false, false, '{}'::text[], 'Wheat flour, buttermilk, cane sugar, butter, eggs, cocoa powder, cream cheese, icing sugar.', 'Contains gluten, dairy, eggs.', 'Box of 6. Best enjoyed within 2 days.', '2025-10-09 08:00:00+00'::timestamptz),
    ('love-letter-valentine-cupcakes', 'Love Letter Valentine Cupcakes', 'Blush and deep red buttercream hearts with delicate gold sprinkle details.', 'Vanilla cupcakes dressed in blush and deep red buttercream hearts with fine gold sprinkle details. Baked for love letters, anniversaries and February tables. Sold in packs of six.', 'cupcakes', 28.00, null::numeric, false, false, false, '{valentines}'::text[], 'Wheat flour, cane sugar, butter, eggs, milk, icing sugar, food colouring, gold sprinkles.', 'Contains gluten, dairy, eggs.', 'Box of 6. Best enjoyed within 2 days.', '2025-10-10 08:00:00+00'::timestamptz),
    ('classic-butter-croissants', 'Classic Butter Croissants (4 Pack)', 'Hand-laminated all-butter croissants with shatteringly crisp layers. Pack of 4.', 'Four classic croissants, laminated by hand over three days with French-style butter. Shatteringly crisp outside, honeycombed and tender inside. Baked fresh every morning at 8:00.', 'croissants', 12.00, 14.00, true, true, false, '{}'::text[], 'Wheat flour, butter, milk, cane sugar, yeast, sea salt.', 'Contains gluten, dairy. Made in a kitchen that also handles nuts and sesame.', 'Pack of 4. Best on baking day; refresh in a 160C oven for 5 minutes.', '2025-09-11 08:00:00+00'::timestamptz),
    ('almond-frangipane-croissants', 'Almond Frangipane Croissants', 'Twice-baked croissants with almond frangipane, flaked almonds and icing sugar.', 'Croissants filled with rum-scented almond frangipane and baked a second time until the edges caramelise. Topped with flaked almonds and a snowfall of icing sugar. The Parisian classic, done faithfully.', 'croissants', 14.00, null::numeric, false, false, false, '{}'::text[], 'Wheat flour, butter, milk, almonds, cane sugar, eggs, rum, yeast, sea salt, icing sugar.', 'Contains gluten, dairy, eggs, almonds.', 'Pack of 2. Best on baking day; refresh in a 160C oven for 5 minutes.', '2025-09-12 08:00:00+00'::timestamptz),
    ('brown-butter-cinnamon-rolls', 'Brown Butter Cinnamon Rolls', 'Gooey cinnamon rolls with brown butter and cream cheese glaze. Tray of 4.', 'Soft, cardamom-scented dough rolled with cinnamon butter and baked until gooey in the centre. Brushed warm with brown butter and drizzled with cream cheese glaze. Tray of four.', 'pastries', 15.00, null::numeric, false, true, false, '{holiday}'::text[], 'Wheat flour, milk, butter, brown sugar, cinnamon, cardamom, eggs, yeast, cream cheese, icing sugar, sea salt.', 'Contains gluten, dairy, eggs.', 'Tray of 4. Best on the day; warm for 20 seconds before serving.', '2025-09-13 08:00:00+00'::timestamptz),
    ('strawberry-vanilla-tart', 'Strawberry Vanilla Tart', 'Crisp pastry shell, slow-cooked vanilla custard and glazed fresh strawberries.', 'A crisp sweet pastry shell filled with slow-cooked vanilla bean custard, crowned with fresh strawberries glazed to a jewel shine. Simple, classic and impossible to improve.', 'pastries', 28.00, null::numeric, true, false, false, '{valentines,mothers-day}'::text[], 'Wheat flour, butter, strawberries, milk, egg yolks, cane sugar, vanilla bean, cornflour, sea salt.', 'Contains gluten, dairy, eggs.', '9 inch tart, serves 6-8. Best on the day; keep chilled.', '2025-09-14 08:00:00+00'::timestamptz),
    ('caramel-apple-danish', 'Caramel Apple Danish', 'Braided danish with cinnamon-spiced apple slices and salted caramel drizzle.', 'Flaky laminated danish folded over cinnamon-spiced apple slices and baked until deep golden. Finished with a salted caramel drizzle. Pairs beautifully with a flat white.', 'pastries', 6.50, null::numeric, false, false, true, '{}'::text[], 'Wheat flour, butter, apples, cane sugar, cinnamon, cream, caramel, yeast, egg.', 'Contains gluten, dairy, eggs.', 'One generous danish. Best on the day.', '2025-11-16 08:00:00+00'::timestamptz),
    ('pumpkin-spice-rolls', 'Pumpkin Spice Rolls', 'Pillowy pumpkin-spice swirls with maple cream cheese frosting. Tray of 4.', 'Autumn in a tray: pillowy rolls swirled with pumpkin spice butter and baked until golden. Frosted with maple cream cheese frosting while still warm. Tray of four.', 'pastries', 16.00, null::numeric, false, false, false, '{holiday}'::text[], 'Wheat flour, pumpkin puree, milk, butter, brown sugar, cinnamon, ginger, nutmeg, cloves, eggs, yeast, cream cheese, maple syrup, icing sugar.', 'Contains gluten, dairy, eggs.', 'Tray of 4. Best on the day.', '2025-10-16 08:00:00+00'::timestamptz),
    ('brown-butter-chocolate-chip-cookies', 'Brown Butter Chocolate Chip Cookies', 'Thick, chewy cookies with nutty brown butter and dark chocolate chunks. Box of 6.', 'Brown butter gives these thick cookies a toffee depth, studded generously with dark chocolate chunks and finished with flaky sea salt. Crackly on top, gooey within. Box of six.', 'cookies', 14.00, 16.50, true, true, false, '{birthday}'::text[], 'Wheat flour, brown butter, dark chocolate, cane sugar, brown sugar, eggs, vanilla, bicarbonate of soda, sea salt.', 'Contains gluten, dairy, eggs, soya.', 'Box of 6. Keeps 4 days in an airtight tin.', '2025-09-17 08:00:00+00'::timestamptz),
    ('lemon-sugar-blossom-cookies', 'Lemon Sugar Blossom Cookies', 'Zesty lemon sugar cookies hand-iced as pastel blossoms. Gift box of 8.', 'Buttery lemon sugar cookies cut into blossoms and hand-iced in pastel pinks and soft yellows. A spring garden you can eat. Gift box of eight.', 'cookies', 16.00, null::numeric, false, false, true, '{mothers-day}'::text[], 'Wheat flour, butter, cane sugar, eggs, lemons, icing sugar, food colouring, vanilla.', 'Contains gluten, dairy, eggs.', 'Gift box of 8. Keeps 10 days in an airtight tin.', '2025-11-15 08:00:00+00'::timestamptz),
    ('oatmeal-lavender-cookies', 'Oatmeal Lavender Cookies', 'Chewy oatmeal cookies with honey and a whisper of culinary lavender.', 'Hearty rolled oats, honey and a whisper of culinary lavender baked into chewy, golden cookies. Calm in cookie form, and lovely with Earl Grey. Box of six.', 'cookies', 15.00, null::numeric, false, false, false, '{}'::text[], 'Rolled oats, wheat flour, butter, honey, cane sugar, eggs, culinary lavender, vanilla, sea salt.', 'Contains gluten, dairy, eggs, oats.', 'Box of 6. Keeps 5 days in an airtight tin.', '2025-09-19 08:00:00+00'::timestamptz),
    ('holiday-gingerbread-friends', 'Holiday Gingerbread Friends', 'Spiced gingerbread people and stars with white icing details. Tin of 10.', 'Deeply spiced gingerbread cut into cheerful people and stars, piped with white icing details. Baked from a recipe older than the bakery itself. Tin of ten.', 'cookies', 18.00, null::numeric, false, false, false, '{holiday}'::text[], 'Wheat flour, golden syrup, butter, cane sugar, ginger, cinnamon, cloves, eggs, icing sugar.', 'Contains gluten, dairy, eggs.', 'Tin of 10. Keeps 2 weeks in an airtight tin.', '2025-10-20 08:00:00+00'::timestamptz),
    ('vanilla-bean-glazed-donuts', 'Vanilla Bean Glazed Donuts', 'Featherlight brioche donuts under a glossy vanilla bean glaze. Box of 4.', 'Featherlight brioche donuts, fried golden and dipped in a glossy vanilla bean glaze while still warm. Speckled with real vanilla seeds. Box of four.', 'donuts', 13.50, null::numeric, true, false, false, '{birthday}'::text[], 'Wheat flour, milk, butter, cane sugar, eggs, yeast, vanilla bean, icing sugar, sea salt.', 'Contains gluten, dairy, eggs.', 'Box of 4. Best on the day.', '2025-09-21 08:00:00+00'::timestamptz),
    ('dark-chocolate-silk-donuts', 'Dark Chocolate Silk Donuts', 'Brioche donuts dipped in silky dark chocolate ganache and chocolate sprinkles.', 'Our brioche donuts dipped in silky dark chocolate ganache and showered with chocolate sprinkles. For the serious chocolate loyalist. Box of four.', 'donuts', 14.50, null::numeric, false, true, false, '{}'::text[], 'Wheat flour, milk, butter, cane sugar, eggs, yeast, dark chocolate, cream, cocoa powder.', 'Contains gluten, dairy, eggs, soya.', 'Box of 4. Best on the day.', '2025-09-22 08:00:00+00'::timestamptz),
    ('rose-raspberry-brioche-donuts', 'Rose Raspberry Brioche Donuts', 'Blush rose-glazed brioche donuts with dried raspberry and rose petals.', 'Pillowy brioche donuts dipped in a pale pink rose glaze and topped with dried raspberries and rose petals. Elegant, floral and not too sweet. Box of four.', 'donuts', 16.00, null::numeric, false, false, true, '{valentines,mothers-day}'::text[], 'Wheat flour, milk, butter, cane sugar, eggs, yeast, rose water, icing sugar, dried raspberries, rose petals.', 'Contains gluten, dairy, eggs.', 'Box of 4. Best on the day.', '2025-11-14 08:00:00+00'::timestamptz),
    ('blushing-rose-macarons', 'Blushing Rose Macarons (12)', 'A dozen pastel rose macarons with raspberry and white chocolate ganache.', 'Twelve pastel pink macaron shells with smooth feet and chewy centres, filled with raspberry and white chocolate ganache. Delicately rose scented. A dozen little love letters.', 'macarons', 28.00, null::numeric, true, false, false, '{valentines,wedding}'::text[], 'Icing sugar, almonds, egg whites, cane sugar, white chocolate, raspberries, rose water, food colouring.', 'Contains almonds, dairy, eggs.', 'Box of 12. Best within 3 days; keep chilled.', '2025-09-24 08:00:00+00'::timestamptz),
    ('pistachio-vanilla-macaron-gift-box', 'Pistachio & Vanilla Macaron Gift Box', 'Gift box of 12 pistachio and vanilla macarons, tied with satin ribbon.', 'An elegant gift box of alternating pistachio and vanilla bean macarons, filled with silky ganache and tied with satin ribbon. Our most gifted box, ready to give exactly as it is.', 'macarons', 32.00, null::numeric, false, false, false, '{wedding,mothers-day}'::text[], 'Icing sugar, almonds, pistachios, egg whites, cane sugar, white chocolate, cream, vanilla bean.', 'Contains almonds, pistachios, dairy, eggs.', 'Box of 12. Best within 3 days; keep chilled.', '2025-09-25 08:00:00+00'::timestamptz),
    ('country-sourdough-loaf', 'Country Sourdough Loaf', 'Slow-fermented sourdough with a blistered crust and open, gently tangy crumb.', 'Our house loaf, fermented slowly for 24 hours with a rye starter fed daily since 2015. Blistered, deeply coloured crust and a soft, open crumb with gentle tang. Baked Thursday to Sunday.', 'bread', 9.00, null::numeric, false, true, false, '{}'::text[], 'Wheat flour, water, rye sourdough starter, sea salt.', 'Contains gluten.', 'One large loaf, about 900g. Keeps 3 days; freezes beautifully.', '2025-08-26 08:00:00+00'::timestamptz),
    ('golden-brioche-loaf', 'Golden Brioche Loaf', 'Rich, feather-soft brioche loaf with a deep golden, buttery crust.', 'A rich, feather-soft loaf enriched with free-range eggs and an outrageous amount of butter. Deep golden crust, cloud-like crumb. Makes legendary French toast.', 'bread', 11.00, null::numeric, false, false, false, '{holiday}'::text[], 'Wheat flour, butter, eggs, milk, cane sugar, yeast, sea salt.', 'Contains gluten, dairy, eggs.', 'One loaf, about 750g. Keeps 3 days; freezes well.', '2025-08-27 08:00:00+00'::timestamptz),
    ('rosemary-sea-salt-focaccia', 'Rosemary Sea Salt Focaccia', 'Dimpled olive oil focaccia with fresh rosemary and flaky sea salt.', 'Airy, olive oil-rich focaccia, dimpled by hand and scattered with fresh rosemary and flaky sea salt. Crisp underneath, cloud-soft within. Cut into generous squares while warm.', 'bread', 10.00, null::numeric, false, false, true, '{}'::text[], 'Wheat flour, extra virgin olive oil, water, fresh rosemary, sea salt, yeast.', 'Contains gluten.', 'One tray square, about 400g. Best on the day.', '2025-11-13 08:00:00+00'::timestamptz),
    ('wild-blueberry-muffins', 'Wild Blueberry Muffins (4 Pack)', 'Tall bakery-style muffins with sugared tops bursting with blueberries.', 'Tall, bakery-style muffins with domed, sugared tops hiding a burst of wild blueberries in every bite. Golden outside, jammy within. Pack of four.', 'muffins', 12.00, null::numeric, true, false, false, '{}'::text[], 'Wheat flour, wild blueberries, cane sugar, butter, eggs, milk, vanilla, baking powder, lemon zest, sea salt.', 'Contains gluten, dairy, eggs.', 'Pack of 4. Best within 2 days.', '2025-09-29 08:00:00+00'::timestamptz),
    ('banana-walnut-crunch-muffins', 'Banana Walnut Crunch Muffins (4 Pack)', 'Deeply banana-y muffins with cinnamon crumble topping and walnut halves.', 'Properly banana-y muffins made with black-ripe bananas, folded with walnuts and crowned with cinnamon crumble. Like banana bread, but dressed for the bakery counter. Pack of four.', 'muffins', 12.00, null::numeric, false, false, false, '{}'::text[], 'Wheat flour, bananas, walnuts, brown sugar, butter, eggs, cinnamon, oats, baking soda, sea salt.', 'Contains gluten, dairy, eggs, walnuts, oats.', 'Pack of 4. Best within 3 days.', '2025-09-30 08:00:00+00'::timestamptz)
  ) as d(slug, name, short_description, description, category_slug, price, compare_at_price,
         is_featured, is_best_seller, is_new, seasonal_collections, ingredients, allergens,
         servings_info, created_at)
  join public.categories c on c.slug = d.category_slug;
  get diagnostics v_product_count = row_count;

  -- -------------------------------------------------------------- product images
  -- One cover image per product; three hero products get a second gallery shot
  -- so the product page thumbnail row has something to switch to.
  -- @demo-images
  insert into public.product_images (product_id, url, alt, sort_order, is_cover)
  select p.id, d.url, d.alt, d.sort_order, d.is_cover
  from (values
    ('vanilla-bean-celebration-cake', './vanilla-bean-cake.jpg',        'Vanilla bean celebration cake with white chocolate shards and dried flowers', 0, true),
    ('midnight-chocolate-truffle-cake', './chocolate-truffle-cake.jpg', 'Midnight chocolate truffle cake with glossy ganache and chocolate curls',     0, true),
    ('red-velvet-dream-cake',         './red-velvet-cake.jpg',          'Red velvet dream cake with cream cheese frosting and crumble coating',        0, true),
    ('lemon-rosemary-olive-oil-cake', './lemon-rosemary-cake.jpg',      'Lemon rosemary olive oil cake with candied lemon slices and rosemary',        0, true),
    ('spiced-carrot-walnut-cake',     './carrot-walnut-cake.jpg',       'Spiced carrot walnut cake with cream cheese frosting and marzipan carrots',   0, true),
    ('garden-wedding-cake',           './wedding-cake.jpg',             'Three tier garden wedding cake with blush sugar flowers',                     0, true),
    ('garden-wedding-cake',           './gallery-cake-decorating.jpg',  'Piping blush buttercream flowers onto a celebration cake',                    1, false),
    ('salted-caramel-chocolate-cupcakes', './chocolate-cupcakes.jpg',   'Salted caramel chocolate cupcakes with caramel drizzle',                      0, true),
    ('vanilla-blossom-berry-cupcakes', './vanilla-berry-cupcakes.jpg',  'Vanilla cupcakes with raspberry buttercream and fresh raspberries',           0, true),
    ('red-velvet-crumble-cupcakes',   './red-velvet-cupcakes.jpg',      'Red velvet crumble cupcakes with cream cheese frosting',                      0, true),
    ('love-letter-valentine-cupcakes', './heart-cupcakes.jpg',          'Valentine cupcakes with blush and red buttercream hearts',                    0, true),
    ('classic-butter-croissants',     './butter-croissants.jpg',        'Stack of golden flaky butter croissants on parchment paper',                  0, true),
    ('classic-butter-croissants',     './gallery-coffee-pastry.jpg',    'Butter croissant served beside a cappuccino with latte art',                  1, false),
    ('almond-frangipane-croissants',  './almond-croissants.jpg',        'Almond frangipane croissants with flaked almonds and icing sugar',            0, true),
    ('brown-butter-cinnamon-rolls',   './cinnamon-rolls.jpg',           'Brown butter cinnamon rolls with cream cheese glaze in a baking tray',        0, true),
    ('strawberry-vanilla-tart',       './strawberry-tart.jpg',          'Strawberry vanilla tart with glazed fresh strawberries in a spiral',          0, true),
    ('caramel-apple-danish',          './apple-danish.jpg',             'Caramel apple danish with braided golden crust and caramel drizzle',          0, true),
    ('pumpkin-spice-rolls',           './pumpkin-spice-rolls.jpg',      'Pumpkin spice rolls with maple cream cheese frosting',                        0, true),
    ('brown-butter-chocolate-chip-cookies', './chocolate-chip-cookies.jpg', 'Brown butter chocolate chip cookies with flaky sea salt',               0, true),
    ('lemon-sugar-blossom-cookies',   './sugar-blossom-cookies.jpg',    'Lemon sugar cookies hand-iced as pastel blossom flowers',                     0, true),
    ('oatmeal-lavender-cookies',      './oatmeal-lavender-cookies.jpg', 'Oatmeal lavender cookies stacked on a ceramic plate',                         0, true),
    ('holiday-gingerbread-friends',   './gingerbread-cookies.jpg',      'Decorated gingerbread friends and stars with white icing details',            0, true),
    ('vanilla-bean-glazed-donuts',    './glazed-donuts.jpg',            'Vanilla bean glazed donuts with shiny glaze on a wire rack',                  0, true),
    ('dark-chocolate-silk-donuts',    './chocolate-donuts.jpg',         'Dark chocolate silk donuts with glossy ganache and sprinkles',                0, true),
    ('rose-raspberry-brioche-donuts', './rose-raspberry-donuts.jpg',    'Rose raspberry brioche donuts with rose glaze and rose petals',               0, true),
    ('blushing-rose-macarons',        './macarons-pink.jpg',            'Pastel pink rose macarons arranged in a neat row',                            0, true),
    ('blushing-rose-macarons',        './macarons-assorted.jpg',        'Assorted pastel macarons arranged in an open gift box',                       1, false),
    ('pistachio-vanilla-macaron-gift-box', './macarons-assorted.jpg',   'Pistachio and vanilla macaron gift box tied with satin ribbon',               0, true),
    ('country-sourdough-loaf',        './artisan-sourdough.jpg',        'Round artisan sourdough loaf with a scored, deep golden crust',               0, true),
    ('golden-brioche-loaf',           './brioche-loaf.jpg',             'Golden braided brioche loaf with glossy crust on a cooling rack',             0, true),
    ('rosemary-sea-salt-focaccia',    './focaccia.jpg',                 'Rosemary sea salt focaccia with dimpled surface and rosemary sprigs',         0, true),
    ('wild-blueberry-muffins',        './blueberry-muffins.jpg',        'Bakery style wild blueberry muffins with domed sugared tops',                 0, true),
    ('banana-walnut-crunch-muffins',  './banana-walnut-muffins.jpg',    'Banana walnut crunch muffins with crumble topping and walnut halves',         0, true)
  ) as d(product_slug, url, alt, sort_order, is_cover)
  join public.products p on p.slug = d.product_slug and p.demo_batch_id = 'bb-demo-v1';

  -- ------------------------------------------------------------ product options
  -- Five products carry options (spec suggests at least 3-4). One option is
  -- required (the gift box ribbon) so the storefront demo also exercises the
  -- "Choose options" flow; the rest are optional add-ons.
  -- @demo-options
  insert into public.product_options (product_id, name, choices, is_required, sort_order)
  select p.id, d.name, d.choices, d.is_required, d.sort_order
  from (values
    ('vanilla-bean-celebration-cake', 'Personalise your cake', '[{"label":"Add a written message","price_delta":0},{"label":"Add gold leaf accents","price_delta":6},{"label":"Add extra candles","price_delta":2}]'::jsonb, false, 0),
    ('midnight-chocolate-truffle-cake', 'Make it a celebration', '[{"label":"Add a written message on a chocolate plaque","price_delta":0},{"label":"Add gold leaf accents","price_delta":6},{"label":"Add extra candles","price_delta":2}]'::jsonb, false, 0),
    ('garden-wedding-cake', 'Design touches', '[{"label":"Extra sugar flower accents","price_delta":25},{"label":"Gold leaf detailing","price_delta":35},{"label":"Include a tasting box","price_delta":0}]'::jsonb, false, 0),
    ('blushing-rose-macarons', 'Gift packaging', '[{"label":"Classic gift box","price_delta":0},{"label":"Ribbon and gift wrap","price_delta":4},{"label":"Handwritten card","price_delta":2}]'::jsonb, false, 0),
    ('pistachio-vanilla-macaron-gift-box', 'Ribbon colour', '[{"label":"Ivory satin ribbon","price_delta":0},{"label":"Blush pink ribbon","price_delta":0},{"label":"Metallic gold ribbon","price_delta":3}]'::jsonb, true, 0)
  ) as d(product_slug, name, choices, is_required, sort_order)
  join public.products p on p.slug = d.product_slug and p.demo_batch_id = 'bb-demo-v1';

  -- --------------------------------------------------------------- site settings
  -- Single row of warm defaults. ON CONFLICT DO NOTHING means: if an admin has
  -- already saved their own settings, loading the demo catalog never overwrites
  -- them. NOTE: site_settings deliberately has no is_demo/demo_batch_id columns
  -- (spec section 4) — settings represent the live shop configuration and are
  -- excluded from remove_demo_catalog by design.
  -- @demo-settings
  insert into public.site_settings (
    id, bakery_name, tagline, hero_title, hero_subtitle, hero_image, hero_cta_label,
    announcement_text, announcement_enabled, currency_code, currency_symbol,
    whatsapp_number, phone, email, address, opening_hours,
    instagram_url, facebook_url, tiktok_url,
    pickup_enabled, delivery_enabled, delivery_fee, delivery_free_over, min_order_amount,
    about_title, about_text, custom_cake_note, custom_cake_sizes, custom_cake_extras,
    policy_note, created_at
  ) values (
    1,                                                    -- id (single settings row)
    'Butter & Bloom',                                     -- bakery_name
    'Artisan Bakery',                                    -- tagline
    'Freshly baked,| every day',                          -- hero_title ("|" = line break, matches the reference layout)
    'Handcrafted pastries, celebration cakes and slow-fermented breads — made in small batches, fresh every morning.', -- hero_subtitle
    './hero-croissants.jpg',                              -- hero_image
    'Order Now',                                          -- hero_cta_label
    'Croissant mornings: fresh batches out of the oven at 8:00, Wednesday to Sunday.', -- announcement_text
    true,                                                 -- announcement_enabled
    'USD',                                                -- currency_code
    '$',                                                  -- currency_symbol
    '15550108899',                                        -- whatsapp_number (digits only, demo number)
    '+1 (555) 010-8899',                                  -- phone
    'hello@butterandbloom.test',                          -- email
    '12 Meadowlark Lane, Willow Creek, Portland, OR 97205', -- address
    '[{"label":"Monday","hours":"Closed"},{"label":"Tuesday","hours":"Closed"},{"label":"Wednesday","hours":"8:00 - 18:00"},{"label":"Thursday","hours":"8:00 - 18:00"},{"label":"Friday","hours":"8:00 - 19:00"},{"label":"Saturday","hours":"8:00 - 19:00"},{"label":"Sunday","hours":"9:00 - 16:00"}]'::jsonb, -- opening_hours
    'https://instagram.com/butterandbloom',               -- instagram_url
    'https://facebook.com/butterandbloom',                -- facebook_url
    'https://www.tiktok.com/@butterandbloom',             -- tiktok_url
    true,                                                 -- pickup_enabled
    true,                                                 -- delivery_enabled
    5.00,                                                 -- delivery_fee
    60.00,                                                -- delivery_free_over
    15.00,                                                -- min_order_amount
    'Our Story',                                          -- about_title
    'Butter & Bloom began in a small home kitchen with one stand mixer and a stubborn belief that cake should taste as beautiful as it looks. Ten years on, we still fold, laminate and pipe everything by hand in small batches — real butter, seasonal fruit, no shortcuts.', -- about_text
    'Estimates are a starting point. We confirm availability and the final price by phone within one working day.', -- custom_cake_note
    '[{"label":"6 inch — serves 8","price":38},{"label":"8 inch — serves 14","price":52},{"label":"10 inch — serves 22","price":74},{"label":"Two-tier 6 + 8 inch — serves 22","price":98}]'::jsonb, -- custom_cake_sizes
    '[{"label":"Minimalist","price":0},{"label":"Floral","price":15},{"label":"Birthday","price":15},{"label":"Themed","price":25},{"label":"Wedding","price":60},{"label":"Custom","price":30},{"label":"Written message","price":5}]'::jsonb, -- custom_cake_extras
    'Orders are confirmed by phone or WhatsApp before your slot is reserved. Collection orders can be picked up in shop; delivery is available within 10 km. No payment is taken online.', -- policy_note
    '2025-08-01 08:00:00+00'::timestamptz                 -- created_at
  )
  on conflict (id) do nothing;

  -- ---------------------------------------------------------------- testimonials
  -- Three warm, generic sample quotes; the home page labels them as samples.
  -- @demo-testimonials
  insert into public.testimonials (author, quote, rating, is_published, is_demo, demo_batch_id, created_at)
  values
    ('Amelia R.', 'The vanilla bean cake was the centrepiece of the whole birthday table — moist, delicate and not too sweet. Everyone asked where it came from.', 5, true, true, 'bb-demo-v1', '2025-08-15 08:00:00+00'::timestamptz),
    ('Daniel & Sofia', 'We ordered croissants for a family brunch and they vanished within minutes. Flaky, buttery, honestly the best we have had outside Paris.', 5, true, true, 'bb-demo-v1', '2025-08-15 08:00:00+00'::timestamptz),
    ('Priya M.', 'The team turned a blurry inspiration photo into the wedding cake of my dreams. Warm, patient and so talented.', 5, true, true, 'bb-demo-v1', '2025-08-15 08:00:00+00'::timestamptz);
  get diagnostics v_testimonial_count = row_count;

  -- ---------------------------------------------------------------------- result
  return jsonb_build_object(
    'loaded',       v_product_count,
    'skipped',      false,
    'categories',   v_category_count,
    'collections',  v_collection_count,
    'products',     v_product_count,
    'testimonials', v_testimonial_count
  );
end;
$$;


create or replace function public.remove_demo_catalog()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_products          integer := 0;
  v_categories        integer := 0;
  v_collections       integer := 0;
  v_testimonials      integer := 0;
  v_orders            integer := 0;
  v_cake_requests     integer := 0;
  v_reservations      integer := 0;
  v_contact_messages  integer := 0;
begin
  -- Demo product images + options disappear automatically through the
  -- ON DELETE CASCADE on product_images.product_id / product_options.product_id.
  -- Deleting demo products never damages real order history: order_items that
  -- referenced them fall back to product_id = NULL while keeping their
  -- product_name / unit_price snapshots. (Demo orders below are removed
  -- outright, together with their items via cascade.)
  delete from public.products
    where is_demo = true and demo_batch_id = 'bb-demo-v1';
  get diagnostics v_products = row_count;

  delete from public.categories
    where is_demo = true and demo_batch_id = 'bb-demo-v1';
  get diagnostics v_categories = row_count;

  delete from public.collections
    where is_demo = true and demo_batch_id = 'bb-demo-v1';
  get diagnostics v_collections = row_count;

  delete from public.testimonials
    where is_demo = true and demo_batch_id = 'bb-demo-v1';
  get diagnostics v_testimonials = row_count;

  -- The four request tables are included in case demo-flagged records were
  -- ever created; a normal load_demo_catalog() inserts none of them.
  delete from public.orders
    where is_demo = true and demo_batch_id = 'bb-demo-v1';
  get diagnostics v_orders = row_count;

  delete from public.cake_requests
    where is_demo = true and demo_batch_id = 'bb-demo-v1';
  get diagnostics v_cake_requests = row_count;

  delete from public.reservations
    where is_demo = true and demo_batch_id = 'bb-demo-v1';
  get diagnostics v_reservations = row_count;

  delete from public.contact_messages
    where is_demo = true and demo_batch_id = 'bb-demo-v1';
  get diagnostics v_contact_messages = row_count;

  -- site_settings is intentionally NOT touched: it is the live shop
  -- configuration and carries no demo flags (see spec section 4).

  return jsonb_build_object(
    'products',         v_products,
    'categories',       v_categories,
    'collections',      v_collections,
    'testimonials',     v_testimonials,
    'orders',           v_orders,
    'cake_requests',    v_cake_requests,
    'reservations',     v_reservations,
    'contact_messages', v_contact_messages
  );
end;
$$;

-- Demo management is admin-only: Postgres grants EXECUTE to PUBLIC by default,
-- so we explicitly take it away from everyone and hand it back to the bakery
-- administrators (and the server-side service_role).
revoke execute on function public.load_demo_catalog()   from anon, public;
revoke execute on function public.remove_demo_catalog() from anon, public;

grant execute on function public.load_demo_catalog()   to authenticated;
grant execute on function public.remove_demo_catalog() to authenticated;
grant execute on function public.load_demo_catalog()   to service_role;
grant execute on function public.remove_demo_catalog() to service_role;

commit;


-- =============================================================================
--  DONE.
--  Next step: run supabase-seed.sql (or use admin.html → Demo Data → Load).
--  Verify in Supabase: Table Editor should show the 12 tables, and after
--  seeding 30 products under products with is_demo = true.
-- =============================================================================
