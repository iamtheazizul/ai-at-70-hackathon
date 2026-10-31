# Aisle Mapper

A contributor tool for mapping grocery stores. Contributors describe a store step by step, the app generates a floor plan, and shoppers get the shortest route through it for their list.

## Run it

It's plain ES modules with no build step and no dependencies.

```bash
npm start          # serves the folder (npx serve) — open the printed URL
npm test           # runs the core + routing tests (Node 18+)
```

Browsers block ES modules from `file://`, so open it through a local server rather than double-clicking `index.html`. Any static host works for deploying, including GitHub Pages and Netlify.

## Project structure

```
index.html                 markup only
styles/app.css             all styles (light + dark themes)
src/
  main.js                  entry point: wires UI modules together, boots the app
  core/                    pure data + layout logic (no DOM, runs in Node)
    constants.js           departments, keywords, the 8 points, flows, sizes
    model.js               store/aisle model, neighbour answers (setNb), search helpers
    example.js             a fully answered example store
    layout.js              map generation from contributor answers
  routing/                 pure routing logic (no DOM, runs in Node)
    matching.js            shopping-list product → section matching
    shortestPath.js        Dijkstra + path reconstruction
    stopOrder.js           Held-Karp (≤12 stops) and nearest-neighbour + 2-opt
    floorGrid.js           floor rasterisation, stand points, grid path search, directions
    storeGraph.js          builds the weighted section graph for a store
    tripPlanner.js         planTrip(): list → ordered legs with paths and directions
  services/
    vision.js              suggestCategoriesFromPhotos(): photo model placeholder
  ui/                      browser UI
    app.js                 shared state, persistence (localStorage), cross-module hooks
    dom.js                 small DOM helpers (toast, escaping, two-click confirm)
    modal.js               reusable modal sheet
    illustrations.js       inline SVG icons + orientation/flow drawings
    wizard.js              contributor flow (store → count → aisles → neighbours)
    photos.js              photo column: capture/upload, calls services/vision.js
    map2d.js               2D floor plan editor, drag with live distance readout
    view3d.js              3D view (Three.js, loaded globally in index.html)
    tripPanel.js           "Plan a trip" panel
tests/
  core.test.js             node:test suite for model, layout, matching and routing
```

How the layers depend on each other:
- `core/` and `routing/` never touch the DOM, so they can be reused as-is, for example in a backend or a mobile app.
- `ui/` modules share state through `ui/app.js`.
- `ui/` modules call each other through `hooks` (set up in `main.js`), which avoids import cycles.

## Contributor flow

1. **Store**: name and street address.
2. **How many**: total aisles and sections, including ones without a code (Produce, Bakery…).
3. **Aisles**: one row per aisle:
   - **Aisle code**: optional. A blank code marks a section.
   - **Aisle categories**: what's on the shelves.
   - **Photo**: take or upload photos to fill categories (model placeholder).
   - **Orientation**: horizontal or vertical, judged standing at the entrance facing in.
4. **Neighbors**: one screen per aisle with 8 points (corners + sides).
   - Pick what sits next to each point: another aisle, the store wall, the entrance, the checkout, or open floor.
   - Answers mirror automatically to the other aisle.
   - Each screen ends with a **flow** choice: closest → furthest, furthest → closest, left → right, or right → left.
5. **Map**: the layout is generated, then can be customized:
   - drag with a live distance readout in feet, resize, rotate and recolor
   - search for an item
   - switch to a 3D view
   - plan a trip

## Layout generation (`core/layout.js`)

`generateFromAnswers(store)` places the first aisle, then walks the neighbour graph breadth-first:
- Each neighbour goes on its side with a 6 ft walkway.
- If two aisles would collide, the new one is nudged further out in the same direction.
- Aisles marked against a store wall snap to that wall.
- The entrance and checkout go where contributors said they are.

One grid cell is 2 ft.

## Trip planner (`routing/`)

`planTrip(store, listText)` steps:
1. **Match** each product to sections (`matching.js`): exact > partial > fuzzy, with plural handling.
2. **Build the graph** (`storeGraph.js`). Nodes are sections plus the entrance and checkout. Edges come from:
   - contributor neighbour answers
   - sections that are physically close on the map
   - the entrance and checkout, linked to their 3 closest sections

   Edge weights are real walking distances in feet, measured on the floor grid around the shelves.
3. **Shortest paths** with Dijkstra (`shortestPath.js`).
4. **Order the stops** (`stopOrder.js`): Held-Karp for up to 12 stops, nearest-neighbour + 2-opt beyond that.
5. **Expand each leg** into a grid path and turn-by-turn directions (`floorGrid.js`), such as `↑ 34 ft toward back`, `→ 9 ft right`.

The result is a plain object, documented in `tripPlanner.js`.

## Connecting the photo model

Edit `src/services/vision.js`:

```js
export async function suggestCategoriesFromPhotos(files) {
  // send `files` (File objects) to your vision model
  // return an array of category strings, e.g. ["cereal", "oatmeal"]
  return null; // null = model not connected
}
```

## Data

The store lives in `localStorage` under `aisle-mapper-v2`. The map screen can copy the store as JSON or import pasted JSON. Each aisle looks like:

```json
{
  "id": "k3j9x2a", "no": "4", "items": ["condiments", "peanut butter"],
  "orient": "v", "flow": "fc",
  "nb": { "w": "<aisle id>", "e": "<aisle id>", "s": "checkout" },
  "x": 22.5, "y": 9, "w": 1.5, "h": 15, "ht": 6, "dept": "Pantry", "color": "#7A6A3A"
}
```

`nb` keys are the 8 points: `nw n ne e se s sw w`, where `n` is the back of the store and `s` is the entrance side. Values are aisle ids or `wall`, `entrance`, `checkout`, or `open`.

## External resources

The page loads these from CDNs:
- Google Fonts
- Three.js 0.128.0 and OrbitControls, from jsDelivr
