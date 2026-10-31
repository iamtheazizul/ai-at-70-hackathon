-- Shoptimal MVP schema. No language model.
-- Demonstration rows are sample data, not a surveyed store map.
-- Apply in the Supabase SQL editor, or with: npm run apply-schema

create table if not exists stores (
  id bigint generated always as identity primary key,
  name text not null unique,
  note text not null default 'Demonstration data. Not a surveyed store map.'
);

create table if not exists products (
  id bigint generated always as identity primary key,
  name text not null unique
);

create table if not exists synonyms (
  id bigint generated always as identity primary key,
  product_id bigint not null references products (id) on delete cascade,
  phrase text not null
);
create unique index if not exists synonyms_phrase_lower_idx on synonyms (lower(phrase));

create table if not exists locations (
  id bigint generated always as identity primary key,
  store_id bigint not null references stores (id) on delete cascade,
  product_id bigint not null references products (id) on delete cascade,
  aisle text not null,
  unique (store_id, product_id)
);

create table if not exists substitute_rules (
  id bigint generated always as identity primary key,
  store_id bigint not null references stores (id) on delete cascade,
  product_id bigint not null references products (id) on delete cascade,
  substitute_product_id bigint not null references products (id),
  unique (store_id, product_id),
  check (product_id <> substitute_product_id)
);

create table if not exists lists (
  id bigint generated always as identity primary key,
  store_id bigint not null references stores (id) on delete cascade,
  title text not null,
  created_at timestamptz not null default now()
);

create table if not exists list_items (
  id bigint generated always as identity primary key,
  list_id bigint not null references lists (id) on delete cascade,
  position int not null,
  raw_text text not null,
  product_id bigint references products (id),
  unique (list_id, position)
);

create table if not exists trips (
  id bigint generated always as identity primary key,
  store_id bigint not null references stores (id) on delete cascade,
  shopper text not null default 'Ross',
  completed_at timestamptz
);

create table if not exists trip_items (
  id bigint generated always as identity primary key,
  trip_id bigint not null references trips (id) on delete cascade,
  product_id bigint references products (id),
  raw_text text not null,
  status text not null check (status in ('open', 'found', 'skipped', 'missing', 'substituted')),
  substitute_product_id bigint references products (id)
);

grant select on stores, products, synonyms, locations, substitute_rules, lists, list_items, trips, trip_items to anon, authenticated;

alter table stores enable row level security;
alter table products enable row level security;
alter table synonyms enable row level security;
alter table locations enable row level security;
alter table substitute_rules enable row level security;
alter table lists enable row level security;
alter table list_items enable row level security;
alter table trips enable row level security;
alter table trip_items enable row level security;

drop policy if exists demo_read on stores;
drop policy if exists demo_read on products;
drop policy if exists demo_read on synonyms;
drop policy if exists demo_read on locations;
drop policy if exists demo_read on substitute_rules;
drop policy if exists demo_read on lists;
drop policy if exists demo_read on list_items;
drop policy if exists demo_read on trips;
drop policy if exists demo_read on trip_items;

create policy demo_read on stores for select to anon, authenticated using (true);
create policy demo_read on products for select to anon, authenticated using (true);
create policy demo_read on synonyms for select to anon, authenticated using (true);
create policy demo_read on locations for select to anon, authenticated using (true);
create policy demo_read on substitute_rules for select to anon, authenticated using (true);
create policy demo_read on lists for select to anon, authenticated using (true);
create policy demo_read on list_items for select to anon, authenticated using (true);
create policy demo_read on trips for select to anon, authenticated using (true);
create policy demo_read on trip_items for select to anon, authenticated using (true);

insert into stores (name, note)
values (
  'Sample Store (not a surveyed map)',
  'Demonstration data. Not a surveyed store map.'
)
on conflict (name) do nothing;

insert into products (name) values
  ('Orange juice'),
  ('Green yogurt'),
  ('Chickpeas'),
  ('Whole milk'),
  ('Oat milk'),
  ('Bread'),
  ('Bananas'),
  ('Eggs'),
  ('Apple juice'),
  ('Plain yogurt')
on conflict (name) do nothing;

insert into synonyms (product_id, phrase)
select p.id, s.phrase
from (values
  ('Orange juice', 'OJ'),
  ('Orange juice', 'orange juice'),
  ('Green yogurt', 'the green yogurt'),
  ('Green yogurt', 'green yogurt'),
  ('Chickpeas', 'garbanzo beans'),
  ('Chickpeas', 'garbanzo')
) as s(product_name, phrase)
join products p on p.name = s.product_name
where not exists (
  select 1 from synonyms existing where lower(existing.phrase) = lower(s.phrase)
);

insert into locations (store_id, product_id, aisle)
select st.id, p.id, loc.aisle
from (values
  ('Orange juice', 'Aisle 6, drinks'),
  ('Green yogurt', 'Aisle 4, dairy'),
  ('Chickpeas', 'Aisle 5, tinned'),
  ('Whole milk', 'Aisle 4, dairy'),
  ('Oat milk', 'Aisle 4, dairy'),
  ('Bread', 'Aisle 2, bakery'),
  ('Bananas', 'Aisle 1, produce'),
  ('Eggs', 'Aisle 4, dairy'),
  ('Apple juice', 'Aisle 6, drinks'),
  ('Plain yogurt', 'Aisle 4, dairy')
) as loc(product_name, aisle)
join products p on p.name = loc.product_name
join stores st on st.name = 'Sample Store (not a surveyed map)'
on conflict (store_id, product_id) do nothing;

insert into substitute_rules (store_id, product_id, substitute_product_id)
select st.id, src.id, dst.id
from (values
  ('Orange juice', 'Apple juice'),
  ('Green yogurt', 'Plain yogurt')
) as rule(source_name, dest_name)
join products src on src.name = rule.source_name
join products dst on dst.name = rule.dest_name
join stores st on st.name = 'Sample Store (not a surveyed map)'
on conflict (store_id, product_id) do nothing;

with cleared as (
  delete from trips t
  using stores s
  where t.store_id = s.id
    and s.name = 'Sample Store (not a surveyed map)'
    and t.shopper = 'Ross'
  returning t.id
),
ins as (
  insert into trips (store_id, shopper, completed_at)
  select s.id, 'Ross', stamp
  from stores s
  cross join (values
    (timestamptz '2026-10-01'),
    (timestamptz '2026-10-08'),
    (timestamptz '2026-10-15')
  ) as dates(stamp)
  where s.name = 'Sample Store (not a surveyed map)'
  returning id, completed_at
)
insert into trip_items (trip_id, product_id, raw_text, status)
select ins.id, p.id, p.name, 'found'
from ins
join products p on (
  (ins.completed_at = timestamptz '2026-10-01' and p.name in ('Whole milk', 'Bread', 'Orange juice', 'Bananas'))
  or (ins.completed_at = timestamptz '2026-10-08' and p.name in ('Whole milk', 'Bread', 'Orange juice', 'Green yogurt'))
  or (ins.completed_at = timestamptz '2026-10-15' and p.name in ('Whole milk', 'Bread', 'Eggs', 'Orange juice'))
);
