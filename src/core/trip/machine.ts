import type { EntryId, ListEntry, NodeId, ProductId } from '../types';
import { isReversible, type TripEvent } from './events';

export type EntryStatus =
  | 'pending'
  | 'collected'
  | 'skipped'
  | 'substituted'
  | 'removed'
  | 'left_deliberately';

export interface EntryState {
  entryId: EntryId;
  status: EntryStatus;
  confirmation?: 'scan' | 'manual';
  productId?: ProductId;
  quantity: number;
  lastEvent: number;
}

export interface TripProjection {
  entries: Map<EntryId, EntryState>;
  confirmedNode?: NodeId;
  confirmedAtEvent?: number;
  paused: boolean;
  finished: boolean;
}

/**
 * `skipped` is unresolved; `left_deliberately` is a decision. Keeping them
 * apart all the way to the summary is what makes "forgotten" and "chose not to
 * buy" different numbers in the evaluation.
 */
const UNRESOLVED: ReadonlySet<EntryStatus> = new Set<EntryStatus>(['pending', 'skipped']);
const OBTAINED: ReadonlySet<EntryStatus> = new Set<EntryStatus>(['collected', 'substituted']);

export function isUnresolved(s: EntryStatus): boolean {
  return UNRESOLVED.has(s);
}
export function isObtained(s: EntryStatus): boolean {
  return OBTAINED.has(s);
}

/**
 * Rebuild all state from the append-only log. This is the only definition of
 * trip state; the stored projection is a cache that must equal this.
 *
 * Undo works by exclusion: an `undo` event marks its target as having no
 * effect, but neither row is ever deleted, so the audit trail survives (FR-14
 * and FR-18 stop contradicting each other).
 */
export function project(entries: ListEntry[], events: TripEvent[]): TripProjection {
  const undone = new Set<number>();
  for (const e of events) {
    if (e.kind === 'undo' && e.correctsEvent !== undefined) undone.add(e.correctsEvent);
  }

  const state = new Map<EntryId, EntryState>();
  for (const entry of entries) {
    state.set(entry.id, {
      entryId: entry.id,
      status: 'pending',
      quantity: entry.quantity,
      lastEvent: 0,
    });
  }

  const projection: TripProjection = { entries: state, paused: false, finished: false };

  for (const e of events) {
    if (undone.has(e.id)) continue;

    switch (e.kind) {
      case 'location_confirmed':
      case 'checkin_ocr':
      case 'checkin_manual':
        if (e.payload.node !== undefined) {
          projection.confirmedNode = e.payload.node;
          projection.confirmedAtEvent = e.id;
        }
        break;
      case 'paused':
        projection.paused = true;
        break;
      case 'resumed':
        projection.paused = false;
        break;
      case 'trip_finished':
        projection.finished = true;
        break;
      case 'undo': {
        // The undo itself is the entry's latest event, so the UI can show that
        // something was taken back rather than silently reverting.
        const target = events.find((x) => x.id === e.correctsEvent);
        const id = e.entryId ?? target?.entryId;
        if (id !== undefined) {
          const cur = state.get(id);
          if (cur) cur.lastEvent = e.id;
        }
        break;
      }
      default: {
        const id = e.entryId;
        if (id === undefined) break;
        const cur = state.get(id);
        if (!cur) break;
        applyEntryEvent(cur, e);
        cur.lastEvent = e.id;
      }
    }
  }

  // Re-apply undo bookkeeping after entry events, so an undo issued last wins.
  for (const e of events) {
    if (e.kind !== 'undo') continue;
    const target = events.find((x) => x.id === e.correctsEvent);
    const id = e.entryId ?? target?.entryId;
    if (id === undefined) continue;
    const cur = state.get(id);
    if (cur) cur.lastEvent = Math.max(cur.lastEvent, e.id);
  }

  return projection;
}

function applyEntryEvent(cur: EntryState, e: TripEvent): void {
  switch (e.kind) {
    case 'item_confirmed_scan':
      cur.status = 'collected';
      cur.confirmation = 'scan';
      cur.productId = e.payload.productId;
      break;
    case 'item_confirmed_manual':
      cur.status = 'collected';
      cur.confirmation = 'manual';
      cur.productId = e.payload.productId;
      break;
    case 'item_substituted':
      cur.status = 'substituted';
      cur.confirmation = e.payload.barcode ? 'scan' : 'manual';
      cur.productId = e.payload.productId;
      break;
    case 'item_skipped':
      cur.status = 'skipped';
      break;
    case 'item_removed':
      cur.status = 'removed';
      break;
    case 'item_left_deliberately':
      cur.status = 'left_deliberately';
      break;
    case 'quantity_changed':
      if (e.payload.quantity !== undefined) cur.quantity = e.payload.quantity;
      break;
    default:
      break;
  }
}

export function unresolvedEntries(p: TripProjection): EntryState[] {
  return [...p.entries.values()].filter((e) => isUnresolved(e.status));
}

/** The last action on this entry that can still be taken back. */
export function undoTarget(entryId: EntryId, events: TripEvent[]): TripEvent | undefined {
  const undone = new Set<number>();
  for (const e of events) {
    if (e.kind === 'undo' && e.correctsEvent !== undefined) undone.add(e.correctsEvent);
  }
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.entryId === entryId && isReversible(e.kind) && !undone.has(e.id)) return e;
  }
  return undefined;
}
