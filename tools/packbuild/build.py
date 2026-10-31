#!/usr/bin/env python3
"""Build a sealed store pack from exported master-data rows. Plan section 3.

    python3 tools/packbuild/build.py rows.json packs/out/hannaford-v7 [--photos dir]

Run by the team, never by the app. Emits:

    <out>/manifest.json
    <out>/store.sqlite      read-only at runtime, no writes ever
    <out>/photos/...

What happens here rather than on the phone: all-pairs shortest paths are
precomputed into node_distance with their paths, so the app never runs a path
search (plan section 4). Everything else is normalisation plus digests.

The pack is content-addressed: manifest.json declares every file with a sha256
and a byte length, and the installer refuses a pack whose files do not match.
manifest.json does not declare itself.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

MIN_APP_SCHEMA = 3
RECOGNITION = ["text", "barcode"]

# The plan's read-only schema. aisle carries is_cold and cold_relaxed because
# RouteCore's ambient-before-cold ordering reads them; the excerpt in section 3
# omits them while section 4 depends on them.
SCHEMA = """
CREATE TABLE store (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, address TEXT,
  layout_version TEXT NOT NULL, surveyed_on TEXT NOT NULL,
  permitted_activities TEXT NOT NULL
);
CREATE TABLE aisle (
  id INTEGER PRIMARY KEY, store_id INTEGER NOT NULL REFERENCES store(id),
  label TEXT NOT NULL,
  reference_end_node INTEGER NOT NULL,
  direction_note TEXT,
  is_cold INTEGER NOT NULL DEFAULT 0,
  cold_relaxed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE node (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN
    ('entrance','aisle_end','intersection','checkout','service_desk','landmark')),
  label TEXT NOT NULL,
  aisle_id INTEGER REFERENCES aisle(id),
  x_metres REAL, y_metres REAL,
  photo_path TEXT
);
CREATE TABLE edge (
  id INTEGER PRIMARY KEY,
  a_node INTEGER NOT NULL REFERENCES node(id),
  b_node INTEGER NOT NULL REFERENCES node(id),
  metres REAL NOT NULL,
  measured INTEGER NOT NULL,
  verified_on TEXT NOT NULL,
  CHECK (a_node < b_node)
);
CREATE TABLE node_distance (
  from_node INTEGER NOT NULL REFERENCES node(id),
  to_node   INTEGER NOT NULL REFERENCES node(id),
  metres REAL NOT NULL,
  path_json TEXT NOT NULL,
  PRIMARY KEY (from_node, to_node)
) WITHOUT ROWID;
CREATE TABLE aisle_sign_variant (
  id INTEGER PRIMARY KEY, aisle_id INTEGER NOT NULL REFERENCES aisle(id),
  variant TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('number','category'))
);
CREATE TABLE section (
  id INTEGER PRIMARY KEY, aisle_id INTEGER NOT NULL REFERENCES aisle(id),
  side TEXT NOT NULL CHECK (side IN ('left','right')),
  bay INTEGER NOT NULL,
  access_node INTEGER NOT NULL REFERENCES node(id)
);
CREATE TABLE product (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, brand TEXT, variant TEXT,
  size_text TEXT, size_value REAL, size_unit TEXT,
  category TEXT NOT NULL, photo_path TEXT, photo_source TEXT
);
CREATE TABLE product_barcode (
  barcode TEXT PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES product(id),
  symbology TEXT NOT NULL
);
CREATE TABLE product_location (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES product(id),
  section_id INTEGER NOT NULL REFERENCES section(id),
  shelf_level TEXT,
  source TEXT NOT NULL CHECK (source IN ('survey','staff','observation_reviewed')),
  verified_on TEXT NOT NULL,
  review_status TEXT NOT NULL CHECK (review_status IN ('authoritative','provisional'))
);
CREATE TABLE scheduled_product (
  product_id INTEGER PRIMARY KEY REFERENCES product(id)
);
"""


def die(message: str) -> None:
    print(f"error: {message}", file=sys.stderr)
    sys.exit(1)


def all_pairs(node_ids: list[int], edges: list[dict]) -> list[tuple[int, int, float, list[int]]]:
    """Floyd-Warshall with path reconstruction. 40-80 nodes, so milliseconds."""
    index = {n: i for i, n in enumerate(node_ids)}
    size = len(node_ids)
    dist = [[math.inf] * size for _ in range(size)]
    nxt: list[list[int | None]] = [[None] * size for _ in range(size)]

    for i in range(size):
        dist[i][i] = 0.0
        nxt[i][i] = i

    for e in edges:
        i, j = index[e["a_node"]], index[e["b_node"]]
        # Keep the cheapest if the survey recorded a pair twice.
        if e["metres"] < dist[i][j]:
            dist[i][j] = dist[j][i] = float(e["metres"])
            nxt[i][j], nxt[j][i] = j, i

    for k in range(size):
        for i in range(size):
            if dist[i][k] == math.inf:
                continue
            for j in range(size):
                alt = dist[i][k] + dist[k][j]
                if alt < dist[i][j]:
                    dist[i][j] = alt
                    nxt[i][j] = nxt[i][k]

    out = []
    for a in node_ids:
        for b in node_ids:
            if a == b:
                continue
            i, j = index[a], index[b]
            if nxt[i][j] is None:
                continue  # unreachable: validator 2 and 3 report it, the pack omits it
            path = [a]
            cur = i
            while cur != j:
                cur = nxt[cur][j]  # type: ignore[index]
                path.append(node_ids[cur])
            out.append((a, b, dist[i][j], path))
    return out


def digest(path: Path) -> tuple[str, int]:
    h = hashlib.sha256()
    size = 0
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
            size += len(chunk)
    return h.hexdigest(), size


def main() -> None:
    ap = argparse.ArgumentParser(description="Build a sealed store pack.")
    ap.add_argument("rows", type=Path, help="normalised master-data JSON (see scripts/export-rows.mjs)")
    ap.add_argument("out", type=Path, help="pack directory to create")
    ap.add_argument("--photos", type=Path, help="directory holding the referenced photo files")
    ap.add_argument(
        "--no-photos",
        action="store_true",
        help="build without photos: drops every photo_path from the database so the pack "
             "does not claim files it has not got. A pack with no photos is valid; a pack "
             "referencing missing photos is not.",
    )
    ap.add_argument("--force", action="store_true", help="overwrite the output directory")
    ap.add_argument(
        "--json",
        action="store_true",
        help="also emit rows.json: the same rows as store.sqlite, for readers that cannot "
             "open SQLite (the browser). Declared in the manifest with its own digest.",
    )
    args = ap.parse_args()

    rows = json.loads(args.rows.read_text())
    store = rows["store"]
    nodes, edges = rows["nodes"], rows["edges"]
    node_ids = [n["id"] for n in nodes]

    known = set(node_ids)
    for e in edges:
        for side in ("a_node", "b_node"):
            if e[side] not in known:
                die(f"edge references unknown node {e[side]}")
        if e["a_node"] >= e["b_node"]:
            die(f"edge {e['a_node']}-{e['b_node']} violates a_node < b_node")

    if args.out.exists():
        if not args.force:
            die(f"{args.out} already exists (use --force)")
        shutil.rmtree(args.out)
    (args.out / "photos").mkdir(parents=True)

    # ---- photos ----------------------------------------------------------
    referenced = sorted({
        p for p in (
            [n.get("photo_path") for n in nodes] + [p.get("photo_path") for p in rows["products"]]
        ) if p
    })
    copied: list[str] = []
    if args.no_photos:
        for collection in (nodes, rows["products"]):
            for row in collection:
                row["photo_path"] = None
        print(f"  photos: skipped ({len(referenced)} reference(s) dropped from the database)")
    else:
        if not args.photos:
            die("photos are referenced but --photos was not given (or pass --no-photos)")
        missing = [p for p in referenced if not (args.photos / Path(p).name).is_file()]
        if missing:
            die("missing photo file(s): " + ", ".join(missing[:10]) +
                (f" and {len(missing) - 10} more" if len(missing) > 10 else ""))
        for p in referenced:
            shutil.copy2(args.photos / Path(p).name, args.out / p)
            copied.append(p)
        print(f"  photos: {len(copied)} copied")

    # ---- store.sqlite ----------------------------------------------------
    db_path = args.out / "store.sqlite"
    con = sqlite3.connect(db_path)
    con.executescript(SCHEMA)

    con.execute(
        "INSERT INTO store VALUES (?,?,?,?,?,?)",
        (store["id"], store["name"], store.get("address"), store["layout_version"],
         store["surveyed_on"], json.dumps(store.get("permitted_activities", {}))),
    )
    # Aisles before nodes: node.aisle_id references aisle(id).
    con.executemany(
        "INSERT INTO aisle VALUES (?,?,?,?,?,?,?)",
        [(a["id"], store["id"], a["label"], a["reference_end_node"], a.get("direction_note"),
          int(bool(a.get("is_cold"))), int(bool(a.get("cold_relaxed")))) for a in rows["aisles"]],
    )
    con.executemany(
        "INSERT INTO node VALUES (?,?,?,?,?,?,?)",
        [(n["id"], n["kind"], n["label"], n.get("aisle_id"),
          n.get("x_metres"), n.get("y_metres"), n.get("photo_path")) for n in nodes],
    )
    con.executemany(
        "INSERT INTO edge (a_node,b_node,metres,measured,verified_on) VALUES (?,?,?,?,?)",
        [(e["a_node"], e["b_node"], float(e["metres"]), int(bool(e["measured"])), e["verified_on"])
         for e in edges],
    )
    con.executemany(
        "INSERT INTO aisle_sign_variant (aisle_id,variant,kind) VALUES (?,?,?)",
        [(v["aisle_id"], v["variant"], v["kind"]) for v in rows["aisle_sign_variants"]],
    )
    con.executemany(
        "INSERT INTO section VALUES (?,?,?,?,?)",
        [(s["id"], s["aisle_id"], s["side"], s["bay"], s["access_node"]) for s in rows["sections"]],
    )
    con.executemany(
        "INSERT INTO product (id,name,brand,variant,size_text,category,photo_path) VALUES (?,?,?,?,?,?,?)",
        [(p["id"], p["name"], p.get("brand"), p.get("variant"), p.get("size_text"),
          p["category"], p.get("photo_path")) for p in rows["products"]],
    )
    con.executemany(
        "INSERT INTO product_barcode VALUES (?,?,?)",
        [(b["barcode"], b["product_id"], b.get("symbology", "EAN_13")) for b in rows["product_barcodes"]],
    )
    con.executemany(
        "INSERT INTO product_location (product_id,section_id,shelf_level,source,verified_on,review_status)"
        " VALUES (?,?,?,?,?,?)",
        [(l["product_id"], l["section_id"], l.get("shelf_level"), l["source"],
          l["verified_on"], l["review_status"]) for l in rows["product_locations"]],
    )
    con.executemany(
        "INSERT INTO scheduled_product VALUES (?)",
        [(pid,) for pid in rows.get("scheduled_products", [])],
    )

    distances = all_pairs(node_ids, edges)
    con.executemany(
        "INSERT INTO node_distance VALUES (?,?,?,?)",
        [(a, b, m, json.dumps(path)) for a, b, m, path in distances],
    )

    # Fail the build rather than ship a pack whose own foreign keys do not hold.
    broken = con.execute("PRAGMA foreign_key_check").fetchall()
    if broken:
        con.close()
        die(f"store.sqlite has {len(broken)} foreign key violation(s): {broken[:5]}")

    con.commit()
    con.execute("VACUUM")
    con.close()

    unreachable = len(node_ids) * (len(node_ids) - 1) - len(distances)
    if unreachable:
        print(f"  warning: {unreachable} node pair(s) unreachable; install validators 2 and 3 will fail")

    # ---- rows.json -------------------------------------------------------
    # The same rows, for readers that cannot open SQLite. Emitted after the
    # database so the photo_path edits from --no-photos are already applied and
    # the two cannot disagree about what the pack contains.
    if args.json:
        web_rows = {
            "store": [{"id": store["id"], "name": store["name"],
                       "layout_version": store["layout_version"],
                       "surveyed_on": store["surveyed_on"]}],
            "node": [{"id": n["id"], "kind": n["kind"], "label": n["label"],
                      "aisle_id": n.get("aisle_id"), "x_metres": n.get("x_metres"),
                      "y_metres": n.get("y_metres"), "photo_path": n.get("photo_path")} for n in nodes],
            "edge": [{"a_node": e["a_node"], "b_node": e["b_node"], "metres": float(e["metres"]),
                      "measured": int(bool(e["measured"])), "verified_on": e["verified_on"]} for e in edges],
            "aisle": [{"id": a["id"], "label": a["label"],
                       "reference_end_node": a["reference_end_node"],
                       "direction_note": a.get("direction_note"),
                       "is_cold": int(bool(a.get("is_cold"))),
                       "cold_relaxed": int(bool(a.get("cold_relaxed")))} for a in rows["aisles"]],
            "aisle_sign_variant": rows["aisle_sign_variants"],
            "section": rows["sections"],
            "product": rows["products"],
            "product_barcode": rows["product_barcodes"],
            "product_location": rows["product_locations"],
            "node_distance": [{"from_node": a, "to_node": b, "metres": m, "path_json": json.dumps(path)}
                              for a, b, m, path in distances],
            "scheduled_product": [{"product_id": pid} for pid in rows.get("scheduled_products", [])],
        }
        (args.out / "rows.json").write_text(json.dumps(web_rows, separators=(",", ":")) + "\n")
        print(f"  rows.json: {(args.out / 'rows.json').stat().st_size} bytes")

    # ---- manifest.json ---------------------------------------------------
    survey_dates = sorted({l["verified_on"] for l in rows["product_locations"]} |
                          {e["verified_on"] for e in edges} | {store["surveyed_on"]})
    files = []
    for path in sorted(p for p in args.out.rglob("*") if p.is_file()):
        sha, size = digest(path)
        files.append({"path": str(path.relative_to(args.out)), "sha256": sha, "bytes": size})

    manifest = {
        "pack_id": rows["pack_id"],
        "pack_version": rows["pack_version"],
        "layout_version": store["layout_version"],
        "built_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "surveyed_between": [survey_dates[0], survey_dates[-1]],
        "store": {"id": store["id"], "name": store["name"]},
        "counts": {
            "nodes": len(nodes),
            "edges": len(edges),
            "products": len(rows["products"]),
            "locations": len(rows["product_locations"]),
            "photos": len(copied),
        },
        "requires": {"min_app_schema": MIN_APP_SCHEMA, "recognition": RECOGNITION},
        "files": files,
    }
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")

    print(f"built {args.out}")
    print(f"  store.sqlite: {db_path.stat().st_size} bytes, {len(distances)} node_distance rows")
    print(f"  manifest declares {len(files)} file(s); counts {manifest['counts']}")


if __name__ == "__main__":
    main()
