# `src/core` — platform-neutral trip logic

No DOM, no camera, no network, no SQL. Everything here is pure functions over
plain data, which is what lets it be replayed in CI and reused if the UI layer
ever changes. Covered by `tests/route.test.ts`, `tests/trip.test.ts` and
`tests/recognition.test.ts` (43 tests).

| Path | What it does |
|---|---|
| `types.ts` | Domain types. `StorePack` is a sealed, versioned snapshot a trip pins. |
| `route/distance.ts` | Floyd–Warshall all-pairs over the store graph, plus an unreachable-destination check. Run once at build time so the app never searches. |
| `route/order.ts` | Destination ordering. Held–Karp exact DP up to 13 per block, nearest-neighbour + 2-opt above that. |
| `route/destinations.ts` | List → destinations, deduplicated by access node. Entries with no known location stay unrouted, never invented. |
| `trip/events.ts` | The append-only event kinds, and which are reversible. |
| `trip/machine.ts` | `project()` rebuilds all state from the log. Undo works by exclusion, so nothing is ever deleted. |
| `trip/invariants.ts` | Properties asserted after every event in every test scenario. |
| `recognition/aisleMatcher.ts` | Sign-text → aisle, over a **closed vocabulary** with K-of-N frame agreement. Returns `match`, `ambiguous` or `no_read`. |
| `recognition/barcodeResolver.ts` | Decoded code → `verified`, `known_mismatch` or `unknown_code`, only via a catalogue mapping. |
| `recognition/candidateScorer.ts` | Shelf-finding (experiment). Text-first, with abstention as a first-class outcome. |

## Three invariants worth not breaking

**Recognition never touches a camera frame.** It takes already-extracted text
lines or an already-decoded payload and returns a decision. That separation is
the only reason the same code can be replayed against a saved corpus of store
photographs during evaluation. Pass a frame in here and you lose the ability to
measure recognition quality.

**The event log is the only definition of trip state.** `project()` is truth;
any stored projection is a cache that `checkInvariants()` must find equal to a
full replay. Undo appends a compensating event and never deletes a row, which is
what stops "undo restores the status" and "keep the audit record" from
contradicting each other.

**`method: 'exact'` means optimal within the cold-chain constraint.** Ambient
destinations are ordered before cold ones, which splits the problem into two
blocks and usually keeps both inside exact-DP range. It is *not* the shortest
route overall, and `orderRoute` does not claim to be.

## What is not here

No position tracking, no heading, no live location. A check-in records an aisle;
`endsNeedingDisambiguation()` decides whether the aisle end has to be asked for,
and it asks only when the two ends would produce different instructions.
