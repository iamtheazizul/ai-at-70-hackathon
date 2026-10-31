import type { EntryId, NodeId } from '../types';
import type { DistanceMatrix } from './distance';

/** Several list entries collapse onto one access node; ordering works on these. */
export interface Destination {
  accessNode: NodeId;
  entryIds: EntryId[];
  isCold: boolean;
}

export interface OrderedRoute {
  /** start, every destination access node in visit order, end. */
  sequence: NodeId[];
  metres: number;
  /** 'exact' means optimal *within the ambient-before-cold constraint*. */
  method: 'exact' | 'heuristic' | 'trivial';
  legs: Leg[];
}

export interface Leg {
  from: NodeId;
  to: NodeId;
  metres: number;
  path: NodeId[];
}

/** Above this, exact DP stops being free; 13 is ~1.4M ops and ~1MB of state. */
export const EXACT_MAX = 13;

interface BlockResult {
  /** terminal node -> cheapest cost covering the whole block, ending there. */
  byTerminal: Map<NodeId, { cost: number; order: NodeId[] }>;
  exact: boolean;
}

/**
 * Held-Karp with a fixed start and a free end.
 *
 * dp[mask][i] = cheapest cost starting at `start`, visiting exactly `mask`,
 * ending at members[i]. Returns, for every possible terminal, the cheapest
 * full-coverage path ending there — which is what lets the ambient and cold
 * blocks be joined optimally without guessing the junction.
 */
function exactBlock(start: NodeId, members: NodeId[], dist: DistanceMatrix): BlockResult {
  const n = members.length;
  const size = 1 << n;
  const dp = new Float64Array(size * n).fill(Infinity);
  const parent = new Int16Array(size * n).fill(-1);

  for (let i = 0; i < n; i++) {
    dp[(1 << i) * n + i] = dist.metres(start, members[i]!);
  }

  for (let mask = 1; mask < size; mask++) {
    for (let i = 0; i < n; i++) {
      if (!(mask & (1 << i))) continue;
      const cur = dp[mask * n + i]!;
      if (cur === Infinity) continue;
      for (let j = 0; j < n; j++) {
        if (mask & (1 << j)) continue;
        const nextMask = mask | (1 << j);
        const alt = cur + dist.metres(members[i]!, members[j]!);
        if (alt < dp[nextMask * n + j]!) {
          dp[nextMask * n + j] = alt;
          parent[nextMask * n + j] = i;
        }
      }
    }
  }

  const full = size - 1;
  const byTerminal = new Map<NodeId, { cost: number; order: NodeId[] }>();
  for (let i = 0; i < n; i++) {
    const cost = dp[full * n + i]!;
    if (cost === Infinity) continue;
    const order: NodeId[] = [];
    let mask = full;
    let cur = i;
    while (cur !== -1) {
      order.push(members[cur]!);
      const prev = parent[mask * n + cur]!;
      mask ^= 1 << cur;
      cur = prev;
    }
    order.reverse();
    byTerminal.set(members[i]!, { cost, order });
  }
  return { byTerminal, exact: true };
}

/** Nearest-neighbour seed then 2-opt, for blocks too large for exact DP. */
function heuristicBlock(start: NodeId, members: NodeId[], dist: DistanceMatrix): BlockResult {
  const remaining = [...members];
  const order: NodeId[] = [];
  let at = start;
  while (remaining.length > 0) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const dd = dist.metres(at, remaining[i]!);
      if (dd < bestD) {
        bestD = dd;
        best = i;
      }
    }
    at = remaining[best]!;
    order.push(at);
    remaining.splice(best, 1);
  }

  const cost = (seq: NodeId[]): number => {
    let total = dist.metres(start, seq[0]!);
    for (let i = 1; i < seq.length; i++) total += dist.metres(seq[i - 1]!, seq[i]!);
    return total;
  };

  // 2-opt on an open path with a fixed start and a free end.
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 200) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const candidate = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
        if (cost(candidate) < cost(order) - 1e-9) {
          order.splice(0, order.length, ...candidate);
          improved = true;
        }
      }
    }
  }

  const terminal = order[order.length - 1]!;
  return { byTerminal: new Map([[terminal, { cost: cost(order), order: [...order] }]]), exact: false };
}

function solveBlock(start: NodeId, members: NodeId[], dist: DistanceMatrix): BlockResult {
  if (members.length === 0) return { byTerminal: new Map([[start, { cost: 0, order: [] }]]), exact: true };
  return members.length <= EXACT_MAX
    ? exactBlock(start, members, dist)
    : heuristicBlock(start, members, dist);
}

/**
 * Order destinations from `start` to `end`.
 *
 * The cold-chain rule is a precedence constraint: every ambient destination
 * precedes every cold one. That splits the sequence into two blocks, which is
 * both simpler and much faster than a general precedence solver — and it halves
 * the destination count, so both blocks usually land inside the exact-DP range.
 *
 * What `method: 'exact'` claims, precisely: this is the shortest route **among
 * routes that visit all ambient destinations before all cold ones**. It is not
 * the shortest route overall, and the code does not pretend otherwise.
 */
export function orderRoute(
  start: NodeId,
  end: NodeId,
  destinations: Destination[],
  dist: DistanceMatrix,
): OrderedRoute {
  const ambient = destinations.filter((d) => !d.isCold).map((d) => d.accessNode);
  const cold = destinations.filter((d) => d.isCold).map((d) => d.accessNode);

  const uniq = (xs: NodeId[]): NodeId[] => [...new Set(xs)];
  const ambientNodes = uniq(ambient);
  const coldNodes = uniq(cold.filter((c) => !ambientNodes.includes(c)));

  if (ambientNodes.length === 0 && coldNodes.length === 0) {
    return { sequence: [start, end], metres: dist.metres(start, end), method: 'trivial', legs: legsFor([start, end], dist) };
  }

  const ambientResult = solveBlock(start, ambientNodes, dist);
  // Symmetric distances, so solving the cold block *backwards from the exit*
  // gives, for each possible cold entry point, the cheapest path that covers
  // all cold destinations and finishes at checkout. Computed once.
  const coldResult = coldNodes.length > 0 ? solveBlock(end, coldNodes, dist) : null;

  let best: { cost: number; sequence: NodeId[] } | null = null;
  let exact = ambientResult.exact && (coldResult?.exact ?? true);

  for (const [ambientTerminal, a] of ambientResult.byTerminal) {
    if (coldNodes.length === 0) {
      const cost = a.cost + dist.metres(ambientTerminal, end);
      if (!best || cost < best.cost) best = { cost, sequence: [start, ...a.order, end] };
      continue;
    }
    for (const [coldEntry, c] of coldResult!.byTerminal) {
      const cost = a.cost + dist.metres(ambientTerminal, coldEntry) + c.cost;
      if (!best || cost < best.cost) {
        best = { cost, sequence: [start, ...a.order, ...[...c.order].reverse(), end] };
      }
    }
  }

  if (!best) throw new Error('no route: destinations unreachable from start');

  return {
    sequence: best.sequence,
    metres: best.cost,
    method: exact ? 'exact' : 'heuristic',
    legs: legsFor(best.sequence, dist),
  };
}

function legsFor(sequence: NodeId[], dist: DistanceMatrix): Leg[] {
  const legs: Leg[] = [];
  for (let i = 1; i < sequence.length; i++) {
    const from = sequence[i - 1]!;
    const to = sequence[i]!;
    legs.push({ from, to, metres: dist.metres(from, to), path: dist.path(from, to) });
  }
  return legs;
}

/** Brute force, for tests only: validates the exact solver on small inputs. */
export function bruteForceOrder(
  start: NodeId,
  end: NodeId,
  destinations: Destination[],
  dist: DistanceMatrix,
): number {
  const ambient = [...new Set(destinations.filter((d) => !d.isCold).map((d) => d.accessNode))];
  const cold = [...new Set(destinations.filter((d) => d.isCold).map((d) => d.accessNode))].filter(
    (c) => !ambient.includes(c),
  );

  const perms = <T,>(xs: T[]): T[][] =>
    xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));

  let best = Infinity;
  for (const a of perms(ambient)) {
    for (const c of perms(cold)) {
      const seq = [start, ...a, ...c, end];
      let total = 0;
      for (let i = 1; i < seq.length; i++) total += dist.metres(seq[i - 1]!, seq[i]!);
      best = Math.min(best, total);
    }
  }
  return best;
}
