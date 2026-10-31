# Shoptimal: Technical Implementation Plan

**Companion to** `Shoptimal_PRD_Revised.md` (rev. 30 Oct 2026)
**Scope of this document:** how to build the P0 product, in what order, with what tests. It does not restate the product rationale or the evaluation design; it turns the PRD's P0 requirements into modules, schemas, algorithms, acceptance tests and a gated schedule.

Week numbers (W0, W1, …) are relative, not calendar dates. Map them onto the course calendar once it is confirmed (PRD §12).

---

## 0. The five decisions that gate everything else

Nothing below is worth building until these are settled. Four of the five are answerable in under a week; one has external lead time and must start immediately.

| # | Decision | Owner | Blocks | Deadline |
|---|---|---|---|---|
| D1 | Ross's actual phone: model, OS version, free storage | project team + Ross | platform, camera API, every performance target | W0 |
| D2 | Mobile stack (see §1) | project team | all code | end of W0, after the spike |
| D3 | Pilot store and written permission for surveying + photography | project team | store pack, every field session | W1 |
| D4 | Participant review pathway (IRB/exempt determination) and consent documents | advisors | **field sessions only** — start now, approval lead time can exceed the build | **start W0** |
| D5 | Test catalogue boundary: the 10-item lists, accepted alternatives, and the ~60–100 product rows that back them | project team + Ross | survey effort, barcode eval set | W1 |

**D4 is the schedule risk, not the code.** Institutional review turnaround is outside the team's control and routinely takes longer than a capstone build phase. Submit before the first line of app code is written. If approval is not in hand by the field-session gate, the fallback is team-only walkthroughs plus sponsor sessions under whatever pathway the advisors confirm, reported honestly as a reduced-scope feasibility study (PRD §10, §12).

---

## 1. Platform decision

### Recommendation: build native for the one OS Ross actually uses.

If his phone is an iPhone: **Swift / SwiftUI, iOS 17+**.
If it is Android: **Kotlin / Jetpack Compose, API 29+**.

Do not build cross-platform.

**Why.** The PRD's P0 scope is one shopper, one store, one device, in one academic year. Cross-platform frameworks buy reach, and reach is explicitly out of scope. What they cost is exactly where this project's risk sits: the camera.

On iOS, `DataScannerViewController` (VisionKit) performs offline text recognition **and** barcode decoding in one Apple-maintained component, with a live camera preview, built-in region-of-interest, built-in guidance UI, and VoiceOver support already wired. It covers FR-08 and FR-10 almost directly. In React Native the same capability means a community-maintained frame-processor plugin over `react-native-vision-camera`, a config plugin, a custom dev client (not Expo Go), and a native debugging session every time a frame-format assumption breaks — on a project where "camera integration consumes the schedule" is already a named risk (PRD §12).

On Android, ML Kit's bundled text-recognition and barcode-scanning artifacts (the `play-services-mlkit-*` *bundled* variants, not the thin on-demand ones) ship the models inside the APK. That removes the "pre-download models before the trip" step from FR-03 entirely, which is one fewer thing that can leave the shopper stranded in the store.

Native also hands you the accessibility requirements in §9 of the PRD rather than making you rebuild them: Dynamic Type / system font scale, VoiceOver / TalkBack labels, contrast and touch-target conventions, and one-handed reachability all behave correctly by default and are auditable with first-party tooling.

**The cost you accept:** if the project later needs the other OS, the UI layer is rewritten. Budget that as a P2 concern and say so to the sponsor. A shared pure-logic core (§3, §4) keeps the expensive parts — routing, state machine, matching — portable; only screens and camera glue are platform-bound.

### The spike that could overturn this (W0, 3 days, hard stop)

Build a throwaway app on Ross's actual device — not the simulator, not a newer loaner — that does all six of these:

1. Opens a live camera preview and reads an aisle sign photographed in a real store aisle, returning recognised text with confidences.
2. Decodes an EAN-13 from a real grocery package held at arm's length.
3. Writes 200 rows to a local SQLite database, force-quits mid-write, relaunches, and reports zero corruption.
4. Completes 1–3 with the device in airplane mode, after a cold launch.
5. Renders one step card legibly at the largest system text size, and reads it correctly under the screen reader.
6. Runs the camera for 10 continuous minutes and reports the battery percentage drop and any thermal throttling notice.

**Decision rule.** All six pass → lock the stack (D2) and start §2. Item 1, 2 or 4 fails on the recommended native path → the problem is the device or the OS version, not the framework, and the next question is whether Ross can use a different phone for the pilot. Only consider cross-platform if the team has an existing React Native codebase it would otherwise discard *and* items 1–6 all pass there too; re-run the whole spike before believing it.

Keep the spike's camera and persistence code. Throw the UI away.

---

## 2. Module map

Seven modules. The three in bold contain no platform APIs — no camera, no UI framework, no file system — because they are the three that have to be testable headlessly and in CI (§6).

| Module | Contents | Depends on |
|---|---|---|
| `StorePack` | read-only bundle loader, manifest validation, integrity + connectivity checks | file system |
| **`RouteCore`** | graph types, destination resolution, ordering solver, leg instructions | `StorePack` types only |
| **`TripCore`** | trip state machine, event log, projection, undo, unresolved-entry rules | `RouteCore` types only |
| **`Recognition`** | aisle-label matcher, barcode→product resolver, candidate scorer, abstention rules | nothing |
| `CameraBridge` | capture session, frame throttling, hands text/codes to `Recognition`, never persists frames | platform camera + `Recognition` |
| `TripStore` | writable SQLite, WAL, transactional event append, crash recovery | `TripCore` |
| `UI` | step card, list view, check-in, verify, review-and-finish, settings, survey mode | everything |

The rule that makes §6 possible: **`Recognition` takes already-extracted text strings with confidences, or already-decoded barcode payloads, and returns a decision.** It never touches a camera frame. The platform OCR/barcode component produces text; the matching, thresholding and abstention logic is pure and replayable against a saved corpus. Violating this is the single easiest way to lose the ability to evaluate recognition quality, so treat it as an architectural invariant, not a preference.

---

## 3. Store pack: format, build, validation

### Why it is a sealed bundle

FR-03 requires a complete, versioned pack, and PRD §8 requires that a background update cannot move destinations mid-trip. Both fall out of one design: the pack is immutable, content-addressed, validated before it is installed, and an active trip pins the version it started with.

```
store-pack/
  manifest.json
  store.sqlite          # read-only, no writes ever
  photos/
    entrance-north.webp
    aisle-07-east.webp
    prod-000142.webp
```

`manifest.json`:

```json
{
  "pack_id": "hannaford-wleb",
  "pack_version": 7,
  "layout_version": "2026-10",
  "built_at": "2026-10-28T14:02:00Z",
  "surveyed_between": ["2026-10-20", "2026-10-27"],
  "store": { "id": 1, "name": "Hannaford, West Lebanon" },
  "counts": { "nodes": 46, "edges": 71, "products": 94, "locations": 112, "photos": 38 },
  "requires": { "min_app_schema": 3, "recognition": ["text", "barcode"] },
  "files": [
    { "path": "store.sqlite", "sha256": "…", "bytes": 262144 },
    { "path": "photos/aisle-07-east.webp", "sha256": "…", "bytes": 41231 }
  ]
}
```

### Install is atomic or it did not happen

Download to `packs/.staging-<uuid>/` → verify every `sha256` in `files` → run the six validators below → `rename()` the directory into `packs/<pack_id>-v<version>/` → update a pointer record. A partial download leaves a staging directory that is deleted on next launch and never becomes selectable. This is what "an incomplete pack is identified before use" (FR-03) means concretely.

### The six validators, all run on-device at install

1. **Integrity** — every declared file present, byte length and digest match.
2. **Graph connectivity** — entrance, checkout and every destination access node are mutually reachable; no isolated component. Fail hard: an unreachable destination would otherwise surface as a silent routing failure in the aisle.
3. **Distance matrix completeness** — a finite entry exists for every (destination ∪ {entrance, checkout}) pair.
4. **Catalogue coverage** — every product referenced by a scheduled test list has ≥1 `product_location` row with a non-null `section_id`.
5. **Photo resolution** — every `photo_path` in the database resolves to a file in `photos/`.
6. **Freshness** — any `product_location.verified_on` older than the configured window (start at 30 days) is flagged, not rejected; the UI then uses cautious wording ("last recorded in aisle 7"), per PRD §8.

Validators 1–5 failing blocks the trip with a specific message naming what is missing. Validator 6 is advisory and its result is stored so the UI can read it without recomputing.

### Read-only schema (`store.sqlite`)

```sql
CREATE TABLE store (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, address TEXT,
  layout_version TEXT NOT NULL, surveyed_on TEXT NOT NULL,
  permitted_activities TEXT NOT NULL          -- JSON: survey, photography, participant sessions
);

-- Graph -----------------------------------------------------------------
CREATE TABLE node (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN
    ('entrance','aisle_end','intersection','checkout','service_desk','landmark')),
  label TEXT NOT NULL,                        -- shopper-facing: "Aisle 7, bakery end"
  aisle_id INTEGER REFERENCES aisle(id),      -- set for aisle_end
  photo_path TEXT
);

CREATE TABLE edge (
  id INTEGER PRIMARY KEY,
  a_node INTEGER NOT NULL REFERENCES node(id),
  b_node INTEGER NOT NULL REFERENCES node(id),
  metres REAL NOT NULL,
  measured INTEGER NOT NULL,                  -- 1 = paced/measured, 0 = estimated
  verified_on TEXT NOT NULL,
  CHECK (a_node < b_node)                     -- undirected, stored once
);

-- Precomputed at build time; see §4.
CREATE TABLE node_distance (
  from_node INTEGER NOT NULL REFERENCES node(id),
  to_node   INTEGER NOT NULL REFERENCES node(id),
  metres REAL NOT NULL,
  path_json TEXT NOT NULL,                    -- node ids, for leg instructions
  PRIMARY KEY (from_node, to_node)
) WITHOUT ROWID;

-- Store layout ----------------------------------------------------------
CREATE TABLE aisle (
  id INTEGER PRIMARY KEY, store_id INTEGER NOT NULL REFERENCES store(id),
  label TEXT NOT NULL,                        -- canonical: "7"
  reference_end_node INTEGER NOT NULL REFERENCES node(id),
  direction_note TEXT                         -- "sides named facing from the entrance-side end"
);

CREATE TABLE aisle_sign_variant (              -- everything the sign might actually read
  id INTEGER PRIMARY KEY, aisle_id INTEGER NOT NULL REFERENCES aisle(id),
  variant TEXT NOT NULL,                      -- "7", "AISLE 7", "CEREAL", "BREAKFAST"
  kind TEXT NOT NULL CHECK (kind IN ('number','category'))
);

CREATE TABLE section (
  id INTEGER PRIMARY KEY, aisle_id INTEGER NOT NULL REFERENCES aisle(id),
  side TEXT NOT NULL CHECK (side IN ('left','right')),   -- relative to reference_end_node
  bay INTEGER NOT NULL,
  access_node INTEGER NOT NULL REFERENCES node(id)
);

-- Catalogue -------------------------------------------------------------
CREATE TABLE product (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, brand TEXT, variant TEXT,
  size_text TEXT, size_value REAL, size_unit TEXT,
  category TEXT NOT NULL, photo_path TEXT, photo_source TEXT
);

CREATE TABLE product_barcode (                 -- a product may carry several
  barcode TEXT PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES product(id),
  symbology TEXT NOT NULL
);

CREATE TABLE product_location (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES product(id),
  section_id INTEGER NOT NULL REFERENCES section(id),
  shelf_level TEXT,                            -- 'low' | 'mid' | 'eye' | 'high', nullable
  source TEXT NOT NULL CHECK (source IN ('survey','staff','observation_reviewed')),
  verified_on TEXT NOT NULL,
  review_status TEXT NOT NULL CHECK (review_status IN ('authoritative','provisional'))
);
```

Two things this schema deliberately refuses to do. It never stores a "side" that depends on which way the shopper is facing — `section.side` is defined against `aisle.reference_end_node`, and the UI must translate when it knows the shopper's end and omit the side when it does not. And `product_location` carries `source` and `review_status` on every row, so a shopper-contributed observation can never be mistaken for a surveyed one (FR-19).

### Build pipeline

A small Python tool in `tools/packbuild/`, run by the team, not the app:

```
survey CSV / admin exports
   → normalise + validate rows
   → build graph, run connectivity check
   → all-pairs shortest paths (§4) → node_distance
   → resize photos to ≤ 1024 px long edge, WebP q75, strip EXIF
   → emit store.sqlite + manifest.json with digests
   → pack-lint (the same six validators, run before publishing)
```

Photo handling is a privacy requirement, not an optimisation: strip metadata and reject any frame with an identifiable bystander before it enters the pack (PRD §9).

### Survey workload, honestly

The surveyable unit is the **section** (aisle + side + bay), not the product. Walking one aisle side and recording bay boundaries takes minutes; the per-product cost is then just "which bay". For the D5 catalogue of 60–100 products this is roughly one afternoon per store, plus a re-audit pass before each test session. Scanning barcodes along the shelf does **not** yield bay or shelf height — that has to be entered deliberately — which is why the survey tool's primary field is the section, with the product attached to it.

---

## 4. Routing (`RouteCore`)

### Shortest paths are a build-time problem, not a runtime one

A single supermarket's walkable graph is tiny — on the order of 40–80 nodes. Running Floyd–Warshall over it at pack-build time costs milliseconds and produces a complete `node_distance` table with stored paths. The app therefore never runs a shortest-path search: ordering destinations becomes arithmetic over a lookup table, and the PRD's "replan under 5 s" target (§9) stops being interesting. **Set the real target at p95 < 200 ms**, and treat anything above 1 s as a bug.

### Destinations, not items

Resolve the list to destinations before ordering:

1. For each unresolved list entry, take its accepted product set.
2. Look up `product_location` rows; prefer `review_status = 'authoritative'`, then most recent `verified_on`.
3. Map each to its `section.access_node`.
4. **Deduplicate.** A 20-item list typically collapses to 8–14 distinct access nodes — several items share an aisle. Ordering operates on the deduplicated set; the UI then presents the items at a destination as consecutive steps.
5. Entries with no known location stay **unresolved and unrouted**. They are not silently dropped (FR-01) and they are not given an invented location. They appear in review-and-finish (FR-13) and, if the category location is known, may be offered as a category-level hint only.

### Ordering: exact where it is cheap, heuristic where it is not

The problem is a path-TSP: fixed start (confirmed entrance node), fixed end (checkout), visit every destination, minimise total metres, subject to the cold-chain constraint.

**Cold chain as a precedence constraint.** Every ambient destination precedes every cold/frozen destination. This splits the sequence into two independent blocks, which is both simpler and faster than a general precedence solver:

```
route = [start] + optimal_path(start → ambient block → cold_entry)
               + optimal_path(cold_entry → cold block → checkout)
```

**Solver by block size** (n = destinations in the block):

| n | Method | Cost |
|---|---|---|
| ≤ 2 | enumerate | trivial |
| 3 … 13 | Held–Karp exact DP, O(2ⁿ·n²) | n=13: ~1.4 M operations, ~1 MB state — well under 100 ms |
| ≥ 14 | nearest-neighbour seed + 2-opt + Or-opt to local optimum | bounded iterations, no optimality claim |

Because the cold-chain split halves the destination count, a 20-item list almost always lands in the exact-DP range for both blocks. This matters for the PRD's honesty requirement in §7: you can then state precisely what is true — **each block is solved optimally; the route as a whole is optimal only among routes that respect the ambient-before-cold ordering.** Appending the cold block to an unconstrained optimum would not be optimal, and neither is this; the difference is that this claim is correct.

**Cold-chain escape hatch, as configuration not cleverness.** If a frozen aisle sits next to the entrance, strict precedence produces an absurd route. Handle it with a per-store `cold_relaxation` list in the pack naming sections exempt from the constraint, decided during survey by a human looking at the layout. Do not try to infer it at runtime.

Also compute and store an **exposure estimate** — walking metres from the first cold pick to checkout — so the survey team can see when the constraint is doing nothing useful.

### Legs and instructions

Each leg is `(from_node, to_node, path_json, metres)`. The instruction string is generated from the stored path and node labels: "Head to Aisle 7, bakery end — about 30 metres, past the deli." Instructions are composed from **node labels only**. No compass headings, no "turn left", no distance-remaining countdown — the app does not know the shopper's heading (PRD §6) and an instruction it cannot justify is worse than a shorter one.

### Direction sensitivity: ask only when it changes the answer

An aisle check-in identifies an aisle, not an end. Rather than always interrupting for end disambiguation:

```
candidate_ends = ends(checked_in_aisle)
instructions  = { instruction_for(end) for end in candidate_ends }
if |instructions| == 1 → proceed, no question asked
else                   → ask "Which end are you at?" with the two landmark photos
```

The same test governs whether to state a shelf side: if the shopper's end is unknown, the side is omitted rather than guessed (FR-06).

### Replan triggers

Exactly five, each producing a new route and preserving all completed work (FR-12):

1. A confirmed check-in whose node differs from the expected one.
2. A skip, substitution, or removal.
3. Resume after pause, if the last confirmed location is stale (configurable; start at 10 minutes).
4. "Where am I?" followed by a manual location confirmation.
5. Review-and-finish electing to return for an unresolved item.

Replanning never reorders already-completed destinations and never resurrects a destination the shopper explicitly left.

---

## 5. Trip state (`TripCore` + `TripStore`)

### The event log is the truth

FR-14 and FR-18 together require that undo restores state without destroying the audit record. That is an append-only log with compensating entries, not mutable rows.

```sql
PRAGMA journal_mode = WAL;

CREATE TABLE trip (
  id INTEGER PRIMARY KEY,
  pack_id TEXT NOT NULL, pack_version INTEGER NOT NULL,   -- pinned; never updated mid-trip
  started_at TEXT NOT NULL, ended_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','paused','finished','abandoned')),
  confirmed_node INTEGER, confirmed_at TEXT
);

CREATE TABLE trip_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,     -- monotonic; ordering is by id, not clock
  trip_id INTEGER NOT NULL REFERENCES trip(id),
  at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN (
    'trip_started','location_confirmed','checkin_ocr','checkin_manual',
    'item_confirmed_scan','item_confirmed_manual','item_skipped','item_substituted',
    'item_removed','quantity_changed','help_requested','paused','resumed',
    'recognition_abstained','undo','trip_finished')),
  entry_id INTEGER REFERENCES list_entry(id),
  payload TEXT NOT NULL,                     -- JSON: node, barcode, product_id, confidence…
  corrects_event INTEGER REFERENCES trip_event(id)   -- set only on 'undo'
);

CREATE TABLE entry_state (                   -- derived projection, rebuildable from the log
  entry_id INTEGER PRIMARY KEY REFERENCES list_entry(id),
  status TEXT NOT NULL CHECK (status IN
    ('pending','collected','skipped','substituted','removed','left_deliberately')),
  confirmation TEXT CHECK (confirmation IN ('scan','manual')),
  product_id INTEGER, quantity INTEGER NOT NULL DEFAULT 1,
  last_event INTEGER NOT NULL REFERENCES trip_event(id)
);
```

**Write ordering, which is the whole of the crash-safety story:**

```
BEGIN IMMEDIATE
  INSERT INTO trip_event …
  UPDATE entry_state …           -- projection advanced in the same transaction
COMMIT                            -- durable here
→ only now does the UI advance to the next step
```

The UI never shows a step as done before the commit returns. A kill between commit and render loses nothing: on relaunch, the projection already reflects the event. A kill before commit loses the action, and the shopper repeats one tap. Those are the only two outcomes, which is what FR-14's "state survives app restart" has to mean in practice.

`entry_state` is a cache. Keep a `rebuild()` that replays the log and asserts equality with the stored projection; run it on every launch in debug builds and in the CI invariant suite (§6).

**Undo** inserts an `undo` event with `corrects_event` pointing at the target, then recomputes the affected entry's projection from the log. Nothing is deleted. Scope it to the last reversible action per entry; `trip_finished` is not undoable.

### Status semantics that the PRD insists on

`skipped` and `left_deliberately` are different states and must stay different all the way to the summary. A skipped item is **unresolved** — it keeps appearing in review-and-finish until the shopper decides (FR-11, FR-13). `left_deliberately` is a decision. `removed` means it left the trip. Only `collected` and `substituted` count as obtained, and `confirmation = 'manual'` is reported separately from `'scan'` everywhere, including the evaluation export (PRD §10: "a manually marked item is not independent evidence").

The app must not route the shopper back to a skipped item on its own. Skipped destinations are dropped from routing and resurface only at review-and-finish or on explicit request.

### Progress feedback without interruption

Updating the remaining count must not generate a new prompt per item (PRD §4). Implementation: the count is a persistent, non-announcing element of the step card; the screen reader announces the step, not the counter. Only state changes the shopper initiated produce announcements.

---

## 6. Camera and recognition

### Three modes, never two at once

| Mode | Opens when | Runs | Persists frames |
|---|---|---|---|
| `checkin` | shopper taps "Scan the aisle sign" | text recognition, ~3 fps on downscaled frames | no |
| `verify` | shopper taps "Scan the barcode" | barcode decode only, full rate | no |
| `find` (P1) | shopper taps "Help me find it", stationary | text recognition + candidate scorer | no |
| `survey` | team only, separate screen, visible indicator | capture | **yes, with consent and permission** |

One capture session, reconfigured per mode. Running OCR and barcode simultaneously doubles thermal and battery load for no benefit, and the two tasks want different framing anyway.

**Frame discipline:** process in-memory only; a single-slot queue that *drops* new frames while busy rather than building a backlog (a backlog is how a camera UI comes to feel broken); release every buffer before returning. No shopper frame is ever written to disk or sent anywhere (PRD §9). Survey mode is a different screen with a persistent "Recording for the project" indicator — not a hidden flag on the shopper path.

### Aisle-label matching (FR-08)

Input: recognised text lines with confidences. Output: one of `match(aisle_id)`, `ambiguous([aisle_id])`, `no_read`.

```
for each recognised line:
    normalise: uppercase, strip punctuation, collapse whitespace
    reject if confidence < C_min                       (start C_min = 0.5, tune on corpus)
    match against aisle_sign_variant for THIS store only
       - exact match on a 'number' variant      → strong vote
       - exact match on a 'category' variant    → supporting vote
       - edit distance ≤ 1 on a 'number'        → weak vote ("7" vs "1" misreads are real)
accumulate votes over a sliding window of the last N = 5 frames
accept if one aisle has ≥ K = 3 frame-votes AND no competitor has ≥ 2
else if two aisles tie above threshold          → ambiguous → confirm dialog
else                                            → no_read → "Can't read the sign" + manual picker
```

Three properties worth defending in the write-up. The vocabulary is **closed** — only this store's declared sign variants are candidates — which converts open-ended OCR into a small classification problem and makes wrong-label errors rare. Temporal agreement across frames costs the shopper a second and removes most single-frame misreads. And `no_read` is a legitimate, logged outcome that leads straight to the manual picker, which must work with the camera permission denied entirely (FR-08).

Reading "7" tells you the aisle. It does not tell you where along the aisle the shopper is, or which way they face. The state machine records only `aisle`, and §4's disambiguation test decides whether to ask for the end.

### Barcode verification (FR-10)

Decode → `product_barcode` lookup in the pinned pack → compare against the entry's accepted product set. Four outcomes, all logged distinctly:

| Outcome | Condition | Shopper sees |
|---|---|---|
| verified | product ∈ accepted set | confirm, advance |
| known mismatch | product in catalogue, ∉ accepted set | "That's *X*. You asked for *Y*." → use as substitute / keep looking |
| unknown code | decode succeeded, no catalogue row | "I don't recognise this one" → manual confirm, log observation |
| no decode | nothing read within the attempt window | "Turn the package so the barcode faces the camera" + manual confirm |

**Framing matters more than model quality here.** A 1D barcode needs enough pixels across its width to decode reliably — Google's ML Kit guidance puts the working figure around 190 px for an EAN-13 — so the implementation sets a region of interest, enables continuous autofocus, applies modest zoom, and draws a framing rectangle sized so that a correctly filled frame clears that threshold. Measure and report **time-to-decode from mode open** separately from per-frame decode latency; the first is what the shopper experiences and it is dominated by handling the package, not by the decoder.

Three claims the implementation must not make, per PRD §6: a decoded code confirms identity only through a valid catalogue mapping; it does not prove the item entered the cart; and it does not establish where the product sits on the shelf (FR-19 — an observation needs a recent check-in *plus* explicit shelf confirmation before it can ever become a location row, and even then only `provisional` pending review).

### Shelf-finding experiment (FR-09, P1) — bounded hard

**Preconditions before any of this is built:** the Core-trip gate has passed, the Camera-readiness gate has passed, and ≥ 3 weeks remain before field sessions. Otherwise it does not get built. This is the feature most likely to eat the schedule and least likely to be the project's contribution.

Scope: **12–20 products on one or two bays**, each with 3–8 reference photos captured in survey mode across lighting and angle.

Pipeline, text-first:

```
frame → text recognition → group lines into spatial clusters (packages)
      → score each cluster against the target product's tokens:
            required tokens (size "18 OZ", distinguishing variant word) must appear
            brand/variant token overlap contributes
      → best score ≥ T_accept AND (best − second) ≥ T_margin
            → draw ONE box around that cluster, expanded to the package bounds
        otherwise → ABSTAIN, show the ordinary item card immediately
```

A visual-similarity second stage (small embedding model via Core ML / TFLite, cosine similarity against the reference crops) is added **only if** bench evaluation shows text alone abstaining too often on the test set. Do not build it speculatively.

Interaction rules, straight from the PRD: ask the shopper to stop before opening the mode; one box, no scene dimming, no floating instructions; clear the box the moment recognition is lost, the view closes, or the item is confirmed; barcode verification still follows selection.

`recognition_abstained` is a first-class logged event. The AR comparison in PRD §10 depends on reporting **abstentions separately from wrong confident highlights** — a system that says "I'm not sure" is behaving correctly, and conflating the two would hide the one failure mode that actually harms the shopper.

SAM 3 / 3.1 and large multimodal models belong in `tools/`, on the team's machines: segmenting reference crops, generating labelled evaluation frames, exploring what is learnable. They are not runtime dependencies (PRD §6), and the plan should not pretend otherwise.

---

## 7. Test harness

The PRD sets numeric targets. Targets without a harness that produces them on demand become claims nobody can check, so build the harness before the features it measures.

### 7.1 Recognition evaluation (the one that must exist first)

A command-line / test-target runner over a corpus directory:

```
corpus/
  checkin/
    2026-11-04_hannaford/
      frame_0001.jpg
      ...
      ground_truth.json     # {"frame_0001.jpg": {"aisle": "7", "lighting": "overhead",
                            #   "angle_deg": 25, "distance_m": 4.0}, …}
  barcode/
    known_match/ known_mismatch/ unreadable/
  find/
    target_<product_id>/
```

The runner feeds each frame through the platform text/barcode component and then through the **same `Recognition` code the app uses**, and emits:

- a confusion table: correct / wrong-label / abstained, per aisle
- the same, stratified by lighting, angle and distance bucket
- barcode: verified / known-mismatch-correctly-rejected / false acceptance / no-decode
- latency distribution (p50, p95) for the matching stage
- a CSV of every disagreement, for eyeballing

Define the **attempt window** before testing (propose 4 s for check-in, 6 s for barcode) and hold it fixed; a target of "90% within an attempt" is meaningless without it. Deliberately include hard cases: adjacent aisle numbers, category-only signs, signs from the *other* pilot store, wrong variants, wrong sizes, scuffed and curved barcodes.

Report **wrong matches and no-results separately** (PRD §10). And state the arithmetic honestly: a 100-attempt barcode test that passes 100/100 is consistent with a true rate anywhere above roughly 97% — it is an initial check, not evidence of 98% population accuracy. Size the eval sets to what you can actually collect and report confidence intervals rather than point claims.

Corpus growth is a side effect of survey trips: survey mode writes frames plus labels in exactly this layout.

### 7.2 Trip simulator (headless, runs in CI)

Scripted event sequences against `TripCore` with no UI and no camera:

```
scenario: wrong_aisle_then_undo
  start_trip(list=L10, pack=hannaford@7)
  confirm_location(entrance_north)
  checkin(aisle=5)                  # not the expected aisle
  expect(replanned, completed_preserved)
  confirm_item(entry=3, scan="0001234567890")
  undo(last)
  expect(entry_3.status == 'pending', event_log.length == 6, no event deleted)
  kill_and_relaunch()
  expect(projection == rebuild_from_log())
```

Required scenarios: wrong aisle, unavailable product, duplicate quantity, accidental confirmation + undo, denied camera permission, kill at every step boundary, pause/resume across a stale-location threshold, review-and-finish with three unresolved entries, airplane mode throughout.

**Invariants asserted after every event in every scenario:**

- entry count is conserved — no entry appears or disappears
- `rebuild_from_log() == entry_state`
- every `undo` has a resolvable `corrects_event`, and no event row is ever deleted
- no entry is simultaneously `collected` and unresolved
- the active trip's `pack_version` never changes
- route contains no completed and no explicitly-left destination

This suite is cheap, fast, and is what lets the team claim "no lost or duplicated item status after interruption" (PRD §9) with something behind it.

### 7.3 Device-level acceptance

| Target (PRD §9) | How it is produced |
|---|---|
| Offline 10-item trip with skip, replan, pause, restart, finish | scripted on-device run in airplane mode, from cold launch, screen-recorded |
| Matching latency: OCR p95 < 1 s, barcode p95 < 0.5 s | §7.1 runner on-device; report *after a usable frame is available* and report acquisition time separately |
| Replan < 5 s for a 20-item list | instrumented timer; expected p95 < 200 ms (§4) — report the real number, not the target |
| Battery over a standard 45-min session | fixed brightness, logged camera-on seconds, named device, 3 repetitions, report percentage points and any thermal throttling |
| Accessibility | first-party accessibility audit, plus manual pass: largest text size, screen reader end-to-end, contrast, 44 pt targets, one-handed reach |

Every number in the final report carries its device, OS version, build and date. A target that fails leads to a fix or an explicit scope reduction before that feature enters a field session — not to a softened target.

---

## 8. Build order and gates

Twelve working weeks of build, relative numbering. Each gate has an exit condition that is a test result, not a judgement.

| Week | Work | Gate at end |
|---|---|---|
| **W0** | D1 device inventory · submit D4 participant review · platform spike (§1) · start D3 store permission | **G0 Stack locked.** All six spike items pass on Ross's device. |
| **W1** | Pack build tool, graph schema, survey forms. Survey one aisle block + D5 catalogue boundary. | |
| **W2** | `StorePack` loader + six validators. First real pack for the pilot store. Trip simulator skeleton (§7.2) with invariants. | **G1 Data foundation.** Pack installs and validates on-device; all test-list destinations audited. |
| **W3** | `TripCore` state machine, `TripStore` event log, undo. No camera, no routing — list and manual advance only. | |
| **W4** | `RouteCore`: distance lookup, destination resolution, cold-chain split, Held–Karp + 2-opt, leg instructions. | |
| **W5** | Step card UI, list view, pause/resume, review-and-finish, local summary. Accessibility pass as it is built, not after. | **G2 Core trip (no camera).** Full 10-item offline trip with skip, undo, kill/relaunch, replan — simulator green, one on-device run clean. |
| **W6** | Recognition eval runner (§7.1). Capture the check-in corpus on a store visit. Aisle-label matcher + check-in UI + manual fallback. | |
| **W7** | Barcode verify: resolver, four outcomes, framing guide. Capture the barcode corpus. Run both evaluations. | **G3 Camera readiness.** Eval reports exist with stratified results, failure modes documented, manual fallback usable with camera permission denied. |
| **W8** | Team walkthroughs over every §7.2 scenario on-device. Battery, latency, accessibility measurements. Fix list. | **G4 Field-ready.** All §7.3 targets measured and reported; no P0 requirement without a passing acceptance condition. |
| **W9** | Re-audit test-list locations. Familiarisation session. First consented sessions (gated on D4). | |
| **W10** | Field sessions continue. Fixes only — no new features. | |
| **W11–12** | Shelf-finding experiment **only if** G2–G4 passed and the comparison can be run properly; otherwise analysis and write-up. | **G5 Optional AR.** Measurable value with no increase in wrong selections or effort, abstentions reported separately. |

**Three ordering choices worth defending.** The trip works end to end before the camera exists (W3–W5), so a camera that disappoints costs a feature rather than the project. The evaluation runner is built before the matcher it evaluates (W6), so there is never a period where recognition "seems fine". And W10 is a feature freeze: field sessions are the deliverable, and a plan that leaves them to the last week has no room for the fixes they will generate.

**Kill rules, agreed in advance.** If G3 is not met by end of W7, the shelf-finding experiment is cancelled and the check-in OCR becomes optional-with-manual-default. If D4 is unresolved by W9, the study is reported as a team-and-sponsor feasibility study with the reduced scope stated plainly. If the pack toolchain is not producing a validated pack by end of W2, cut to one store and the minimum catalogue immediately rather than at W5.

---

## 9. P0 requirement traceability

Every P0 requirement maps to a module and to the test that proves it. A requirement with no test in this column is not done.

| FR | Module | Proving test |
|---|---|---|
| FR-01 list 1–20, unmatched retained | `TripCore`, `UI` | simulator: unmatched entry survives route, pause, restart, appears in review |
| FR-02 route ordering, cold deferred | `RouteCore` | unit: optimality within block vs brute force (n ≤ 8); precedence held; unknown locations unrouted |
| FR-03 versioned pack, offline | `StorePack` | six validators unit-tested; on-device airplane-mode trip; corrupted pack rejected with a named cause |
| FR-06 one primary action | `UI` | accessibility audit at largest text size; no shelf side shown when the end is unknown |
| FR-07 guidance without a raised phone | `RouteCore`, `UI` | review: no instruction references a heading or live position; no moving location indicator exists in the codebase |
| FR-08 OCR check-in + manual fallback | `Recognition`, `CameraBridge` | §7.1 check-in report; manual picker works with camera permission denied |
| FR-10 barcode verification | `Recognition` | §7.1 barcode report with false-acceptance count; manual confirmations labelled `manual` everywhere |
| FR-11 unresolved items, skip/substitute/ask | `TripCore` | simulator: unresolved entries survive pause/restart/replan; substitution requires approval |
| FR-12 replan after confirmation | `RouteCore`, `TripCore` | simulator: five replan triggers, completed work preserved |
| FR-13 review before finishing | `TripCore`, `UI` | simulator: no entry can reach `finished` without an explicit per-entry decision |
| FR-14 pause, resume, undo | `TripStore` | simulator: kill at every step boundary; undo restores status with the event retained |
| FR-18 local events + summary | `TripStore` | schema check: scan vs manual, skips, undo, check-ins, help all distinguishable in the export |
| FR-20 survey + reviewed packs | `tools/packbuild` | pack-lint passes; every survey record carries reference direction, section, date, source |

---

## 10. Open technical questions

Answers change the design; none of them block starting W0.

1. **Does Ross's device run the recommended OS version?** If it is an older iPhone or an Android below API 29, the camera API story changes and the spike must use the real device (D1).
2. **Pack size budget.** 94 products with photos at ≤ 1024 px WebP is on the order of 5–10 MB. Confirm free storage on his device and decide whether product photos ship in the pack or download separately (they must be present before the trip either way).
3. **Does the pilot store use category-only signage on any aisle?** If signs read "BREAKFAST" with no number, the `aisle_sign_variant` vocabulary carries the weight and the matcher's category votes stop being merely supporting. Determine during the W1 survey.
4. **Two ends, one sign.** Some aisles are signed at one end only. Decide per aisle during survey whether end disambiguation uses a landmark photo or an explicit two-button choice.
5. **Stale-location threshold.** Start at 10 minutes for "last confirmed location is too old to route from" and 30 days for product-location freshness; both need a pass against real observations.
6. **Speech.** Confirm whether Ross wants synthesised speech at all, and whether it must work offline (it does, on both platforms, but the voice must be pre-downloaded — add it to the pre-trip readiness check if used).
7. **Export format for the evaluation.** Agree the CSV/JSON schema with whoever analyses the sessions before W8, so the logs contain what the analysis needs rather than what was convenient to record.
8. **Where the eval corpus lives.** It contains store interior photographs taken under permission. Decide retention, access and whether any of it can appear in the final report, before the W6 capture trip.

---

## 11. What this plan deliberately does not build

Restating, because scope creep in a capstone usually arrives as a reasonable-sounding addition:

no continuous AR position tracking; no 3D store reconstruction; no beacons or retailer IT integration; no automatic cart detection; no recognition of products outside the test catalogue; no live stock or price data; no checkout or payment; no cloud dependency during a trip; no second store until the first works; no VR component.
