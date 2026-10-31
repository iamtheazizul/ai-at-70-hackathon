# Database notes

How the app's store object maps onto the schema, and what's left before the app talks to the database.

## Where the code is

- `src/data/repo.js` picks the storage backend. Today it's `localRepo` (the browser).
- `src/data/localRepo.js` is the browser storage. It defines the interface every backend must have: `listStores`, `getStore`, `saveStore`, `deleteStore`, all async.
- `src/data/dbMapping.js` is a pure translator between the app and the database tables. It's tested in `tests/dbMapping.test.js`.
  - `storeToRows(S, ctx)` turns a store into rows for writing.
  - `rowsToStore(rows)` turns rows that were read back into a store.

To connect the database, write a `supabaseRepo.js` with the same four methods, using `dbMapping.js` for the translation. Then point `repo.js` at it. Nothing in the UI changes.

## Table mapping

| App | Table | Notes |
|---|---|---|
| store name/address | `stores` | `slug` comes from the name (`slugify`) |
| wizard progress, floor size | `layout_drafts` | `stage`, `reached`, `wizard_index`, `placed`, `layout_stale` (= `dirty`) |
| each aisle/section | `layout_shapes` | app id kept in `client_id`; `kind` aisle/section; positions in metres |
| left/right categories | `layout_shape_categories` | one row per category, `position` = order (left shelf first, then right) |
| `nb` answers | `layout_neighbours` | one row per answered point; aisle → `target_shape_id`, else `target_special` |
| entrance, checkout | `layout_fixtures` | `door` → `entrance`, checkout fixture → `checkout` |

Units: 1 map cell = 2 ft = 0.6096 m. Shelf height is stored in feet in the app and metres in the database.

## Schema change needed for aisle sides

`layout_shape_categories` has no way to say which shelf a category is on. Add:

```sql
alter table public.layout_shape_categories
  add column side text check (side in ('left', 'right'));
-- null = a section (Produce, Bakery…), which has no sides
```

`left`/`right` are judged walking the aisle in its `flow` direction. That matches the `side` values in your `destinations` table.

## Saving: order of writes

Categories and neighbours point at shapes by uuid, which only exists after the shapes are inserted:

1. upsert `stores`, create or get `floors` and `map_versions` (status `draft`), upsert `layout_drafts`
2. insert `layout_shapes` and read back `id` for each `client_id`
3. insert `layout_shape_categories` and `layout_neighbours`, swapping `shape_client_id` / `target_client_id` for those uuids
4. upsert `layout_fixtures`

Doing this in one Postgres function (RPC) keeps a save all-or-nothing.

## Reading for shoppers

Shoppers should only see a store's latest `map_versions` row with `status = 'approved'`. Contributors open their `draft`.

## Things to confirm in the schema

- Several composite foreign keys show up as two single-column constraints with the same name. For example, `survey_captures_floor_id_store_id_fkey` references `floors(id)` and `floors(store_id)`. This is probably how the export prints composite keys. If the real database has them split, the `store_id` halves will fail, because `floors.store_id` isn't unique.
- `products.name` and `product_aliases.alias` use `shoptimal.norm()`. The app's matching (`normItem` in `routing/matching.js`) should behave the same way, so that a search here finds the same things the database does.
