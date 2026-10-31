// Pack manifest types, mirroring manifest.json in plan §3.
//
// Pure data. The manifest is what the installer trusts before it trusts the
// pack: it declares every file with a digest and a byte length, so integrity is
// checkable without opening store.sqlite.

export interface ManifestFile {
  /** Relative to the pack root, e.g. "store.sqlite" or "photos/aisle-07-east.webp". */
  path: string;
  sha256: string;
  bytes: number;
}

export interface PackManifest {
  packId: string;
  packVersion: number;
  layoutVersion: string;
  /** ISO 8601 instant. */
  builtAt: string;
  /** Earliest and latest survey date in the pack, as ISO dates. */
  surveyedBetween: [string, string];
  store: { id: number; name: string };
  counts: {
    nodes: number;
    edges: number;
    products: number;
    locations: number;
    photos: number;
  };
  requires: {
    minAppSchema: number;
    recognition: string[];
  };
  files: ManifestFile[];
}

/** One precomputed all-pairs entry, from the pack's node_distance table. */
export interface PackedDistance {
  fromNode: number;
  toNode: number;
  metres: number;
  /** Node ids from `fromNode` to `toNode` inclusive, for leg instructions. */
  path: number[];
}

/** A file the installer actually found in the staging directory. */
export interface StagedFile {
  path: string;
  sha256: string;
  bytes: number;
}
