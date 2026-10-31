# Aisle Mapper

Map grocery stores and plan the shortest shopping trip through them.

- **Shoppers** pick a store, write a shopping list, and follow a step-by-step route from the entrance to checkout. Each stop goes to the exact shelf: "Aisle 4 · left side · about 23 ft in".
- **Contributors** describe a store's aisles: codes, orientation, walk direction, what's on each side, and what's next to what. The app generates the floor plan, which they can then fine-tune.

## Run it

Plain ES modules with no build step and no dependencies.

```bash
npm start          # serves the folder (npx serve); open the printed URL
npm test           # core, routing and database-mapping tests (Node 18+)
```

Browsers block ES modules from `file://`, so use a local server rather than double-clicking `index.html`.

## Project structure

```
index.html                 markup for every screen
styles/app.css             all styles (light + dark)
src/
  main.js                  entry point: picks the screen (home / shop / contribute), boots the app
  core/                    pure logic, no DOM
    constants.js           departments, points, flows, sides, units
    model.js               store/aisle model, neighbours, orientation, flow, left/right sides
    geometry.js            shelf strips of an aisle, exact spot of an item on a side
    layout.js              map generation from contributor answers
    example.js             a fully answered example store
  routing/                 pure routing, no DOM
    matching.js            shopping-list product → aisle side / section
    shortestPath.js        Dijkstra
    stopOrder.js           Held-Karp (≤12 stops), nearest-neighbour + 2-opt
    floorGrid.js           walkable floor grid, stand points, grid paths, directions
    storeGraph.js          weighted graph of shapes + exact item spots
    tripPlanner.js         planTrip(): list → ordered legs with paths and directions
  data/                    where stores are kept
    repo.js                picks the backend (browser today, database later)
    localRepo.js           browser storage, several stores
    dbMapping.js           store object ⇄ database rows (see docs/database.md)
  services/
    vision.js              photo → categories (model placeholder)
  ui/                      browser UI
    app.js                 shared state, saving, hooks between modules
    home.js                start screen (Shop / Map a store), contributor's store list
    shop.js                shopper: store → list → step-by-step trip
    wizard.js              contributor flow: store → count → aisles → neighbours
    photos.js              photo column in the aisle table
    planRenderer.js        draws a floor plan into an <svg> (editor and trip view)
    map2d.js               map editor: select, edit, drag with distance readout
    view3d.js              3D view (Three.js)
    tripPanel.js           "Test a trip" in the map editor
    modal.js, dom.js, illustrations.js
tests/                     node:test suites
docs/database.md           schema mapping, needed migration, write order
```

`core/` and `routing/` never touch the page. They can be reused in a backend or another app as they are.

## Aisles, walk direction and sides

A numbered aisle is a walkway with a shelf on each side, 10 ft wide by 30 ft long by default.
- **Walk direction (flow)** is the way you'd walk the aisle from its first shelves:
  - vertical aisles: closest → furthest, or furthest → closest
  - horizontal aisles: left → right, or right → left
- **Left side / Right side** are what's on your left and right hand while walking that way, listed in the order you pass them.
- Reversing the walk direction swaps the two lists automatically, so items stay on the same physical shelf.
- Items are spread evenly along their side. The router walks to the item's spot.

Sections without a code (Produce, Bakery…) are a single block with one category list.

Side-by-side aisles that run the same way are placed back to back, sharing a double-sided shelf, so shoppers walk around the ends to get from one to the next.

## Trip planner

`planTrip(store, list)` steps:
1. Match each product: exact > partial > fuzzy, with plural handling. A match on an aisle side becomes an exact spot.
2. Build the graph. Nodes are shapes, item spots, the entrance and the checkout. Edges come from:
   - contributor neighbour answers
   - physical closeness on the map
   - spot links

   Edge weights are walking distance in feet on the floor grid.
3. Run Dijkstra, then order the stops (Held-Karp up to 12, then nearest-neighbour + 2-opt).
4. Expand each leg into a walking path and directions such as `↑ 34 ft toward back`.

## Database

The app stores data in the browser for now. `docs/database.md` covers:
- how the store object maps to the schema's tables
- the one column the sides feature needs (`layout_shape_categories.side`)
- the order of writes

Connecting the database means writing a `supabaseRepo.js` with the same four methods as `localRepo.js`, then pointing `src/data/repo.js` at it.

## External resources

Google Fonts, plus Three.js 0.128.0 and OrbitControls from jsDelivr.
