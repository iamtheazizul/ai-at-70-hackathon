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

describe('survey geometry', () => {
  it('gives every fixture node a coordinate, so the plan can be drawn', () => {
    const undrawn = nodes.filter((n) => n.xMetres === undefined || n.yMetres === undefined);
    expect(undrawn.map((n) => n.label)).toEqual([]);
  });

  it('never records a walk shorter than the straight line between its ends', () => {
    // A walkable path cannot beat a straight line. A violation is not
    // imprecision: the coordinates and the paced distance disagree about the
    // shape of the store, so one of the two survey records is wrong.
    const impossible = edges.flatMap((e) => {
      const direct = straightLine(e.a, e.b);
      if (direct === null || e.metres >= direct - 1e-9) return [];
      return [`${e.a}-${e.b}: paced ${e.metres} m, drawn ${direct.toFixed(1)} m apart`];
    });
    expect(impossible).toEqual([]);
  });

  it('agrees with the drawing to within survey tolerance', () => {
    // Paced distances run long: strides vary and walkways jog around displays.
    // 15% catches a transposed digit without failing on honest imprecision.
    const TOLERANCE = 0.15;
    const disagreements = edges.flatMap((e) => {
      const direct = straightLine(e.a, e.b);
      if (direct === null || direct === 0) return [];
      if (e.metres <= direct * (1 + TOLERANCE)) return [];
      return [`${e.a}-${e.b}: paced ${e.metres} m, drawn ${direct.toFixed(1)} m`];
    });
    expect(disagreements).toEqual([]);
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
