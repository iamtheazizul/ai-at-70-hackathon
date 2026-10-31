import { describe, expect, it } from 'vitest';
import { buildDistanceMatrix } from '../src/core/route/distance';
import type { StoreNode } from '../src/core/types';
import { sampleStorePack } from '../src/data/sampleStore';

const { nodes, edges } = sampleStorePack;

const byId = new Map<number, StoreNode>(nodes.map((n) => [n.id, n]));

/** Straight-line metres between two nodes, or null when either is undrawn. */
const straightLine = (a: number, b: number): number | null => {
  const p = byId.get(a);
  const q = byId.get(b);
  if (!p || !q) return null;
  if (p.xMetres === undefined || p.yMetres === undefined) return null;
  if (q.xMetres === undefined || q.yMetres === undefined) return null;
  return Math.hypot(p.xMetres - q.xMetres, p.yMetres - q.yMetres);
};

/** Coordinates and paced metres are both decimals; slack far below survey precision. */
const EPSILON_M = 1e-9;

/**
 * How much longer than the straight line one edge may walk.
 *
 * There is no physical bound here, which is what was wrong with the 15%
 * version of this check: a walk around a shelf run is legitimately much longer
 * than the straight line, so correct survey data would have failed it.
 *
 * What the bound defends is structural, not metric. An edge asserts a direct
 * walk between two adjacent nodes. A paced distance twice the straight line
 * says either the nodes are not adjacent and want a chain between them, or one
 * of the two numbers is a typo. 2x is loose enough for a real detour and still
 * catches a transposed digit: 25 m paced as 52 m trips it.
 */
const MAX_DETOUR = 2;

describe('survey geometry', () => {
  it('gives every fixture node a coordinate, so the plan can be drawn', () => {
    const undrawn = nodes.filter((n) => n.xMetres === undefined || n.yMetres === undefined);
    expect(undrawn.map((n) => n.label)).toEqual([]);
  });

  it('never paces an edge shorter than the straight line between its ends', () => {
    // Walking cannot beat a straight line. A violation is not imprecision: the
    // drawing and the paced distance disagree about the shape of the store, so
    // one of the two survey records is wrong.
    const impossible = edges.flatMap((e) => {
      const direct = straightLine(e.a, e.b);
      if (direct === null || e.metres >= direct - EPSILON_M) return [];
      return [`${e.a}-${e.b}: paced ${e.metres} m, drawn ${direct.toFixed(1)} m apart`];
    });
    expect(impossible).toEqual([]);
  });

  it('never routes any pair shorter than the straight line between them', () => {
    // This adds nothing to the survey check above, and the reason is worth
    // writing down: a path's length is the sum of its edges, each of which is
    // at least its own straight line, and by the triangle inequality that sum
    // is at least the straight line between the path's ends. So per-edge
    // soundness already implies this for every pair. It is kept because it
    // tests something different — buildDistanceMatrix itself. A Floyd-Warshall
    // bug that reported a distance no real walk could achieve would pass the
    // per-edge check and fail here.
    const dist = buildDistanceMatrix(nodes, edges);
    const impossible: string[] = [];
    for (const a of dist.nodes) {
      for (const b of dist.nodes) {
        if (a >= b) continue;
        const direct = straightLine(a, b);
        if (direct === null) continue;
        const walk = dist.metres(a, b);
        if (walk === Infinity || walk >= direct - EPSILON_M) continue;
        impossible.push(`${a}-${b}: walk ${walk.toFixed(1)} m, drawn ${direct.toFixed(1)} m apart`);
      }
    }
    expect(impossible).toEqual([]);
  });

  it('flags an edge too long to be the direct walk it claims to be', () => {
    const suspect = edges.flatMap((e) => {
      const direct = straightLine(e.a, e.b);
      if (direct === null || direct === 0) return [];
      if (e.metres <= direct * MAX_DETOUR) return [];
      return [`${e.a}-${e.b}: paced ${e.metres} m for ${direct.toFixed(1)} m straight`];
    });
    expect(suspect).toEqual([]);
  });

  it('keeps routing independent of the coordinates', () => {
    // The architectural claim in StoreNode: the solver reads Edge.metres and
    // nothing else. Stripping the drawing must leave every distance identical,
    // or geometry has leaked into routing and a store surveyed by pacing alone
    // would route differently.
    const stripped: StoreNode[] = nodes.map(({ xMetres, yMetres, ...rest }) => rest);
    const drawn = buildDistanceMatrix(nodes, edges);
    const undrawn = buildDistanceMatrix(stripped, edges);
    for (const a of drawn.nodes) {
      for (const b of drawn.nodes) {
        expect(undrawn.metres(a, b)).toBe(drawn.metres(a, b));
      }
    }
  });
});
