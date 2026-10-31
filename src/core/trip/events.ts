import type { EntryId, NodeId, ProductId } from '../types';

export type TripEventKind =
  | 'trip_started'
  | 'location_confirmed'
  | 'checkin_ocr'
  | 'checkin_manual'
  | 'item_confirmed_scan'
  | 'item_confirmed_manual'
  | 'item_skipped'
  | 'item_substituted'
  | 'item_removed'
  | 'item_left_deliberately'
  | 'quantity_changed'
  | 'help_requested'
  | 'paused'
  | 'resumed'
  | 'recognition_abstained'
  | 'undo'
  | 'trip_finished';

export interface TripEvent {
  /** Monotonic. Ordering is by id, never by wall clock. */
  id: number;
  at: string;
  kind: TripEventKind;
  entryId?: EntryId;
  payload: {
    node?: NodeId;
    aisleLabel?: string;
    barcode?: string;
    productId?: ProductId;
    quantity?: number;
    confidence?: number;
    mode?: 'checkin' | 'verify' | 'find';
    reason?: string;
  };
  /** Set only on `undo`. The target event is never deleted. */
  correctsEvent?: number;
}

/** Actions a shopper can take back. `trip_finished` is deliberately not one. */
export const REVERSIBLE: ReadonlySet<TripEventKind> = new Set<TripEventKind>([
  'item_confirmed_scan',
  'item_confirmed_manual',
  'item_skipped',
  'item_substituted',
  'item_removed',
  'item_left_deliberately',
  'quantity_changed',
]);

export function isReversible(kind: TripEventKind): boolean {
  return REVERSIBLE.has(kind);
}
