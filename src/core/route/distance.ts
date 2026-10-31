import type { Edge, NodeId, StoreNode } from '../types';

export interface DistanceMatrix {
  /** Metres along the shortest walkable path. Infinity when unreachable. */
  metres(a: NodeId, b: NodeId): number;
  /** Node ids from a to b inclusive, for building leg instructions. */
  path(a: NodeId, b: NodeId): NodeId[];
  nodes: NodeId[];
}

/**
 * Floyd-Warshall over the whole store graph.
 *
 * A supermarket is 40-80 nodes, so all-pairs costs milliseconds and is done
 * once at pack-build time. The app then never runs a path search: ordering
 * destinations is arithmetic over this table.
 */
export function buildDistanceMatrix(nodes: StoreNode[], edges: Edge[]): DistanceMatrix {
  const ids = nodes.map((n) => n.id);
  const index = new Map<NodeId, number>(ids.map((id, i) => [id, i]));
  const n = ids.length;

  const d: number[] = new Array(n * n).fill(Infinity);
  const next: number[] = new Array(n * n).fill(-1);

  for (let i = 0; i < n; i++) {
    d[i * n + i] = 0;
    next[i * n + i] = i;
  }

  for (const e of edges) {
    const i = index.get(e.a);
    const j = index.get(e.b);
    if (i === undefined || j === undefined) {
      throw new Error(`edge references unknown node: ${e.a}-${e.b}`);
    }
    // Undirected, and keep the cheapest if the survey recorded a pair twice.
    if (e.metres < d[i * n + j]!) {
      d[i * n + j] = e.metres;
      d[j * n + i] = e.metres;
      next[i * n + j] = j;
      next[j * n + i] = i;
    }
  }

  for (let k = 0; k < n; k++) {
    for (let i = 0; i < n; i++) {
      const dik = d[i * n + k]!;
      if (dik === Infinity) continue;
      for (let j = 0; j < n; j++) {
        const alt = dik + d[k * n + j]!;
        if (alt < d[i * n + j]!) {
          d[i * n + j] = alt;
          next[i * n + j] = next[i * n + k]!;
        }
      }
    }
  }

  const at = (a: NodeId, b: NodeId): number => {
    const i = index.get(a);
    const j = index.get(b);
    if (i === undefined || j === undefined) throw new Error(`unknown node ${a} or ${b}`);
    return i * n + j;
  };

  return {
    nodes: ids,
    metres: (a, b) => d[at(a, b)]!,
    path: (a, b) => {
      let i = index.get(a);
      const j = index.get(b);
      if (i === undefined || j === undefined) throw new Error(`unknown node ${a} or ${b}`);
      if (next[i * n + j] === -1) return [];
      const out: NodeId[] = [a];
      while (i !== j) {
        i = next[i * n + j]!;
        out.push(ids[i]!);
      }
      return out;
    },
  };
}

/** Validator 2 + 3 from the plan: every destination mutually reachable. */
export function findUnreachable(
  dist: DistanceMatrix,
  from: NodeId,
  required: NodeId[],
): NodeId[] {
  return required.filter((t) => dist.metres(from, t) === Infinity);
}
