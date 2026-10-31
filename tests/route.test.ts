import { describe, expect, it } from 'vitest';
import { buildDistanceMatrix, findUnreachable } from '../src/core/route/distance';
import { bruteForceOrder, orderRoute, type Destination } from '../src/core/route/order';
import { resolveDestinations } from '../src/core/route/destinations';
import { sampleList, sampleStorePack } from '../src/data/sampleStore';

const pack = sampleStorePack;
const dist = buildDistanceMatrix(pack.nodes, pack.edges);

const dest = (accessNode: number, isCold = false): Destination => ({
  accessNode,
  entryIds: [accessNode],
  isCold,
});

describe('distance matrix', () => {
  it('is zero on the diagonal and symmetric', () => {
    for (const id of dist.nodes) expect(dist.metres(id, id)).toBe(0);
    expect(dist.metres(1, 28)).toBe(dist.metres(28, 1));
  });

  it('prefers walking the front aisle over going through an aisle', () => {
    // front(1) -> front(3) is 6 + 6 = 12m, not 25 + 6 + 25.
    expect(dist.metres(11, 13)).toBe(12);
  });

  it('returns a walkable path, not just a cost', () => {
    const path = dist.path(1, 23);
    expect(path[0]).toBe(1);
    expect(path[path.length - 1]).toBe(23);
    let total = 0;
    for (let i = 1; i < path.length; i++) total += dist.metres(path[i - 1]!, path[i]!);
    expect(total).toBeCloseTo(dist.metres(1, 23), 6);
  });

  it('reports unreachable destinations rather than hiding them', () => {
    const isolated = { id: 99, kind: 'landmark' as const, label: 'Detached' };
    const d2 = buildDistanceMatrix([...pack.nodes, isolated], pack.edges);
    expect(findUnreachable(d2, 1, [13, 99])).toEqual([99]);
  });
});

describe('route ordering', () => {
  it('matches brute force on ambient-only sets', () => {
    const destinations = [dest(13), dest(16), dest(21), dest(24)];
    const route = orderRoute(1, 2, destinations, dist);
    expect(route.method).toBe('exact');
    expect(route.metres).toBeCloseTo(bruteForceOrder(1, 2, destinations, dist), 6);
  });

  it('matches brute force when a cold block is present', () => {
    const destinations = [dest(13), dest(16), dest(21), dest(17, true), dest(28, true)];
    const route = orderRoute(1, 2, destinations, dist);
    expect(route.method).toBe('exact');
    expect(route.metres).toBeCloseTo(bruteForceOrder(1, 2, destinations, dist), 6);
  });

  it('visits every ambient destination before any cold one', () => {
    const destinations = [dest(13), dest(16), dest(21), dest(17, true), dest(28, true)];
    const { sequence } = orderRoute(1, 2, destinations, dist);
    const coldNodes = new Set([17, 28]);
    const lastAmbient = Math.max(...sequence.map((n, i) => (!coldNodes.has(n) && n !== 2 ? i : -1)));
    const firstCold = sequence.findIndex((n) => coldNodes.has(n));
    expect(firstCold).toBeGreaterThan(lastAmbient);
  });

  it('starts at the entrance and ends at the checkout', () => {
    const { sequence } = orderRoute(1, 2, [dest(13), dest(17, true)], dist);
    expect(sequence[0]).toBe(1);
    expect(sequence[sequence.length - 1]).toBe(2);
  });

  it('handles an empty list without inventing destinations', () => {
    const route = orderRoute(1, 2, [], dist);
    expect(route.method).toBe('trivial');
    expect(route.sequence).toEqual([1, 2]);
  });

  it('legs cover the sequence and sum to the total', () => {
    const route = orderRoute(1, 2, [dest(13), dest(21), dest(17, true)], dist);
    expect(route.legs).toHaveLength(route.sequence.length - 1);
    const sum = route.legs.reduce((a, l) => a + l.metres, 0);
    expect(sum).toBeCloseTo(route.metres, 6);
  });
});

describe('destination resolution', () => {
  it('deduplicates entries that share an access node', () => {
    // Bagels (4) and sourdough (3) both sit at aisle 2 bay 1.
    const entries = [
      { id: 1, requestText: 'Sourdough', quantity: 1, acceptedProducts: [3], substitutesAllowed: true },
      { id: 2, requestText: 'Bagels', quantity: 1, acceptedProducts: [4], substitutesAllowed: true },
    ];
    const { destinations } = resolveDestinations(entries, pack);
    expect(destinations).toHaveLength(1);
    expect(destinations[0]!.entryIds).toEqual([1, 2]);
  });

  it('keeps an entry with no known location visible and unrouted', () => {
    const { destinations, unrouted } = resolveDestinations(sampleList, pack);
    expect(unrouted).toEqual([10]); // the birthday card
    expect(destinations.every((d) => d.entryIds.length > 0)).toBe(true);
  });

  it('collapses the 10-item list well inside the exact-DP range', () => {
    const { destinations } = resolveDestinations(sampleList, pack);
    const ambient = destinations.filter((d) => !d.isCold).length;
    const cold = destinations.filter((d) => d.isCold).length;
    expect(ambient).toBeLessThanOrEqual(13);
    expect(cold).toBeLessThanOrEqual(13);
    expect(orderRoute(1, 2, destinations, dist).method).toBe('exact');
  });

  it('marks frozen destinations cold', () => {
    const entries = [
      { id: 1, requestText: 'Frozen peas', quantity: 1, acceptedProducts: [12], substitutesAllowed: true },
    ];
    const { destinations } = resolveDestinations(entries, pack);
    expect(destinations[0]!.isCold).toBe(true);
  });
});
