import type { EntryId, ListEntry, ProductLocation, StorePack } from '../types';
import type { Destination } from './order';

export interface ResolvedDestinations {
  destinations: Destination[];
  /** Entries with no known location. Never dropped, never given an invented place. */
  unrouted: EntryId[];
}

/**
 * Resolve a list to destinations, then **deduplicate**. A 20-item list usually
 * collapses to 8-14 access nodes because several items share an aisle, which is
 * what keeps both ordering blocks inside the exact-DP range.
 */
export function resolveDestinations(
  entries: ListEntry[],
  pack: StorePack,
  opts: { freshnessWindowDays?: number; today?: Date } = {},
): ResolvedDestinations {
  const byNode = new Map<number, Destination>();
  const unrouted: EntryId[] = [];

  const sections = new Map(pack.sections.map((s) => [s.id, s]));
  const aisles = new Map(pack.aisles.map((a) => [a.id, a]));

  for (const entry of entries) {
    const loc = bestLocation(entry, pack, opts);
    if (!loc) {
      unrouted.push(entry.id);
      continue;
    }
    const section = sections.get(loc.sectionId);
    const aisle = section ? aisles.get(section.aisleId) : undefined;
    if (!section || !aisle) {
      unrouted.push(entry.id);
      continue;
    }

    const isCold = aisle.isCold && !aisle.coldRelaxed;
    const existing = byNode.get(section.accessNode);
    if (existing) {
      existing.entryIds.push(entry.id);
      // A node is cold only if nothing ambient also lives there.
      existing.isCold = existing.isCold && isCold;
    } else {
      byNode.set(section.accessNode, {
        accessNode: section.accessNode,
        entryIds: [entry.id],
        isCold,
      });
    }
  }

  return { destinations: [...byNode.values()], unrouted };
}

/** Prefer authoritative over provisional, then the most recently verified. */
export function bestLocation(
  entry: ListEntry,
  pack: StorePack,
  opts: { freshnessWindowDays?: number; today?: Date } = {},
): ProductLocation | undefined {
  if (entry.acceptedProducts.length === 0) return undefined;
  const accepted = new Set(entry.acceptedProducts);
  const candidates = pack.locations.filter((l) => accepted.has(l.productId));
  if (candidates.length === 0) return undefined;

  return [...candidates].sort((a, b) => {
    if (a.reviewStatus !== b.reviewStatus) return a.reviewStatus === 'authoritative' ? -1 : 1;
    return b.verifiedOn.localeCompare(a.verifiedOn);
  })[0];
}

/** Advisory only (validator 6): drives cautious wording, never blocks a trip. */
export function isStale(
  loc: ProductLocation,
  freshnessWindowDays = 30,
  today = new Date(),
): boolean {
  const verified = new Date(loc.verifiedOn).getTime();
  if (Number.isNaN(verified)) return true;
  const days = (today.getTime() - verified) / 86_400_000;
  return days > freshnessWindowDays;
}
