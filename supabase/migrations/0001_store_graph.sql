-- ============================================================================
-- Shoptimal master data. THE schema: this is the model the project builds on.
--
-- It is never queried during a shopping trip. Trips read a sealed, versioned
-- pack built from these tables and downloaded in advance (plan SS3). That is
-- why the RLS at the bottom gives anonymous clients no read access to master
-- data at all -- only published packs, and only through store_pack.
--
-- The earlier flat model (stores/products/locations, plural) is kept at
-- supabase/legacy/mvp_demo_flat.sql. It is NOT applied and NOT a migration.
-- src/mvp/remote.ts still speaks it, so the Vite demo stays on its bundled
-- catalogue until a pack-build path exists.
--
-- Apply with: npm run apply-schema
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- stores ----
create table if not exists store (
  id                   bigint generated always as identity primary key,
  name                 text not null,
  address              text,
  layout_version       text not null,
  surveyed_on          date not null,
  permitted_activities jsonb not null default '{}'::jsonb,  -- survey / photography / sessions
  created_at           timestamptz not null default now()
);

-- ----------------------------------------------------------------- graph ----
create table if not exists node (
  id         bigint generated always as identity primary key,
  store_id   bigint not null references store(id) on delete cascade,
  kind       text not null check (kind in
               ('entrance','aisle_end','intersection','checkout','service_desk','landmark')),
  label      text not null,              -- shopper-facing: 'Aisle 7, bakery end'
  aisle_id   bigint,                     -- FK added after aisle exists
  -- Top-down survey coordinates, metres, origin and axes fixed per store in
  -- store.layout_version. Nullable on purpose: routing reads edge.metres and
  -- nothing else, so a store with no drawing still routes. When present they
  -- let the survey be drawn and paced edges cross-checked against the plan.
  x_metres   double precision,
  y_metres   double precision,
  photo_path text
);

create table if not exists edge (
  id          bigint generated always as identity primary key,
  store_id    bigint not null references store(id) on delete cascade,
  a_node      bigint not null references node(id) on delete cascade,
  b_node      bigint not null references node(id) on delete cascade,
  metres      double precision not null check (metres > 0),
  measured    boolean not null default false,   -- true = paced, false = estimated
  verified_on date not null,
  check (a_node < b_node)                       -- undirected, stored once
);
create unique index if not exists edge_pair_idx on edge (a_node, b_node);

create table if not exists aisle (
  id                 bigint generated always as identity primary key,
  store_id           bigint not null references store(id) on delete cascade,
  label              text not null,             -- canonical: '7'
  reference_end_node bigint not null references node(id),
  direction_note     text,                      -- 'sides named facing from the entrance-side end'
  is_cold            boolean not null default false,
  cold_relaxed       boolean not null default false,  -- exempt from ambient-before-cold ordering
  unique (store_id, label)
);

alter table node drop constraint if exists node_aisle_fk;
alter table node add constraint node_aisle_fk
  foreign key (aisle_id) references aisle(id) on delete set null;

-- Everything the sign might actually read. The matcher's vocabulary is closed
-- to this table, which is what keeps wrong-label OCR errors rare.
create table if not exists aisle_sign_variant (
  id       bigint generated always as identity primary key,
  aisle_id bigint not null references aisle(id) on delete cascade,
  variant  text not null,                       -- '7', 'AISLE 7', 'CEREAL'
  kind     text not null check (kind in ('number','category')),
  unique (aisle_id, variant)
);

create table if not exists section (
  id          bigint generated always as identity primary key,
  aisle_id    bigint not null references aisle(id) on delete cascade,
  side        text not null check (side in ('left','right')),  -- vs aisle.reference_end_node
  bay         int not null,
  access_node bigint not null references node(id),
  unique (aisle_id, side, bay)
);

-- ------------------------------------------------------------- catalogue ----
create table if not exists product (
  id           bigint generated always as identity primary key,
  name         text not null,
  brand        text,
  variant      text,
  size_text    text,
  size_value   double precision,
  size_unit    text,
  category     text not null,
  photo_path   text,
  photo_source text
);

create table if not exists product_barcode (
  barcode    text primary key,
  product_id bigint not null references product(id) on delete cascade,
  symbology  text not null default 'EAN_13'
);

create table if not exists product_location (
  id            bigint generated always as identity primary key,
  product_id    bigint not null references product(id) on delete cascade,
  section_id    bigint not null references section(id) on delete cascade,
  shelf_level   text check (shelf_level in ('low','mid','eye','high')),
  source        text not null check (source in ('survey','staff','observation_reviewed')),
  verified_on   date not null,
  review_status text not null check (review_status in ('authoritative','provisional')),
  unique (product_id, section_id)
);

-- A shopper's scan is never a location. It lands here and needs a recent aisle
-- check-in plus explicit shelf confirmation before a human promotes it.
create table if not exists location_observation (
  id               bigint generated always as identity primary key,
  product_id       bigint not null references product(id) on delete cascade,
  store_id         bigint not null references store(id) on delete cascade,
  claimed_aisle    text,
  claimed_section  bigint references section(id),
  supporting_checkin_at timestamptz,
  observed_at      timestamptz not null default now(),
  source           text not null check (source in ('shopper','team')),
  review_outcome   text not null default 'pending'
                     check (review_outcome in ('pending','accepted','rejected')),
  reviewed_by      text,
  reviewed_at      timestamptz
);

-- ------------------------------------------------- pack publication --------
-- A pack is immutable once published. An active trip pins pack_version, so a
-- background publish can never move a destination mid-trip.
create table if not exists store_pack (
  id             bigint generated always as identity primary key,
  store_id       bigint not null references store(id) on delete cascade,
  pack_version   int not null,
  layout_version text not null,
  manifest       jsonb not null,          -- file list with sha256 digests, counts
  storage_path   text not null,           -- Supabase Storage object path
  built_at       timestamptz not null default now(),
  published      boolean not null default false,
  unique (store_id, pack_version)
);

-- ------------------------------------------------------------------ RLS ----
-- This repo is public and the anon key ships in the client, so assume the anon
-- key is known. Anonymous clients may read PUBLISHED packs and nothing else.
alter table store                enable row level security;
alter table node                 enable row level security;
alter table edge                 enable row level security;
alter table aisle                enable row level security;
alter table aisle_sign_variant   enable row level security;
alter table section              enable row level security;
alter table product              enable row level security;
alter table product_barcode      enable row level security;
alter table product_location     enable row level security;
alter table location_observation enable row level security;
alter table store_pack           enable row level security;

drop policy if exists "anon reads published packs" on store_pack;
create policy "anon reads published packs" on store_pack
  for select using (published = true);

-- Observations may be contributed but never read back by anon clients.
drop policy if exists "anon inserts observations" on location_observation;
create policy "anon inserts observations" on location_observation
  for insert with check (source = 'shopper' and review_outcome = 'pending');

-- Master data: no anon policy at all, so no anon access. Team members use an
-- authenticated role; add policies for it once roles are decided (D-open-7).
