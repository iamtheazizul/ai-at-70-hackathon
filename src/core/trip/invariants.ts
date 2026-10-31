import type { ListEntry } from '../types';
import type { TripEvent } from './events';
import { project, type TripProjection } from './machine';

/**
 * Asserted after every event in every simulator scenario. These are the
 * properties that let the team claim "no lost or duplicated item status after
 * interruption" with something behind it.
 */
export function checkInvariants(
  entries: ListEntry[],
  events: TripEvent[],
  stored: TripProjection,
): string[] {
  const violations: string[] = [];

  if (stored.entries.size !== entries.length) {
    violations.push(`entry count not conserved: ${stored.entries.size} vs ${entries.length}`);
  }
  for (const entry of entries) {
    if (!stored.entries.has(entry.id)) violations.push(`entry ${entry.id} missing from projection`);
  }

  // The projection is a cache. It must equal a full replay of the log.
  const rebuilt = project(entries, events);
  for (const [id, want] of rebuilt.entries) {
    const got = stored.entries.get(id);
    if (!got) {
      violations.push(`entry ${id} absent after rebuild`);
      continue;
    }
    if (got.status !== want.status) {
      violations.push(`entry ${id} status drift: stored ${got.status}, rebuilt ${want.status}`);
    }
    if (got.quantity !== want.quantity) {
      violations.push(`entry ${id} quantity drift: stored ${got.quantity}, rebuilt ${want.quantity}`);
    }
    if (got.confirmation !== want.confirmation) {
      violations.push(`entry ${id} confirmation drift: ${got.confirmation} vs ${want.confirmation}`);
    }
  }

  let lastId = -Infinity;
  for (const e of events) {
    if (e.id <= lastId) violations.push(`event ids not monotonic at ${e.id}`);
    lastId = e.id;
    if (e.kind === 'undo') {
      if (e.correctsEvent === undefined) {
        violations.push(`undo ${e.id} has no correctsEvent`);
      } else if (!events.some((x) => x.id === e.correctsEvent)) {
        violations.push(`undo ${e.id} targets missing event ${e.correctsEvent}`);
      }
    }
  }

  return violations;
}
