import { describe, expect, it } from 'vitest';
import type { TripEvent } from '../src/core/trip/events';
import { checkInvariants } from '../src/core/trip/invariants';
import { isUnresolved, project, undoTarget, unresolvedEntries } from '../src/core/trip/machine';
import { sampleList } from '../src/data/sampleStore';

let nextId = 0;
const ev = (kind: TripEvent['kind'], entryId?: number, payload: TripEvent['payload'] = {}, correctsEvent?: number): TripEvent => ({
  id: ++nextId,
  at: new Date(2026, 9, 30, 10, nextId).toISOString(),
  kind,
  entryId,
  payload,
  correctsEvent,
});

const fresh = (): void => {
  nextId = 0;
};

/** Every scenario asserts the invariants after every single event. */
const replayWithInvariants = (events: TripEvent[]): void => {
  for (let i = 1; i <= events.length; i++) {
    const prefix = events.slice(0, i);
    const p = project(sampleList, prefix);
    expect(checkInvariants(sampleList, prefix, p)).toEqual([]);
  }
};

describe('trip projection', () => {
  it('starts every entry pending with its requested quantity', () => {
    fresh();
    const events = [ev('trip_started'), ev('location_confirmed', undefined, { node: 1 })];
    const p = project(sampleList, events);
    expect(p.entries.size).toBe(sampleList.length);
    expect([...p.entries.values()].every((e) => e.status === 'pending')).toBe(true);
    expect(p.entries.get(5)!.quantity).toBe(2);
    expect(p.confirmedNode).toBe(1);
    replayWithInvariants(events);
  });

  it('distinguishes a scanned confirmation from a manual one', () => {
    fresh();
    const events = [
      ev('item_confirmed_scan', 1, { barcode: '4011000000001', productId: 1 }),
      ev('item_confirmed_manual', 2, { productId: 2 }),
    ];
    const p = project(sampleList, events);
    expect(p.entries.get(1)!.confirmation).toBe('scan');
    expect(p.entries.get(2)!.confirmation).toBe('manual');
    replayWithInvariants(events);
  });

  it('keeps a skipped item unresolved but a deliberately-left one resolved', () => {
    fresh();
    const events = [ev('item_skipped', 3, { reason: 'out of stock' }), ev('item_left_deliberately', 4)];
    const p = project(sampleList, events);
    expect(isUnresolved(p.entries.get(3)!.status)).toBe(true);
    expect(isUnresolved(p.entries.get(4)!.status)).toBe(false);
    replayWithInvariants(events);
  });
});

describe('wrong aisle, then undo', () => {
  it('reverts the status, keeps both events, and survives a relaunch', () => {
    fresh();
    const events: TripEvent[] = [
      ev('trip_started'),
      ev('location_confirmed', undefined, { node: 1 }),
      ev('checkin_ocr', undefined, { node: 15, aisleLabel: '5', confidence: 0.91 }),
    ];
    const confirm = ev('item_confirmed_scan', 1, { barcode: '4011000000001', productId: 1 });
    events.push(confirm);

    const target = undoTarget(1, events);
    expect(target?.id).toBe(confirm.id);

    events.push(ev('undo', 1, {}, confirm.id));

    const p = project(sampleList, events);
    expect(p.entries.get(1)!.status).toBe('pending');
    expect(p.entries.get(1)!.confirmation).toBeUndefined();

    // Nothing was deleted: the confirmation is still in the log.
    expect(events.some((e) => e.id === confirm.id)).toBe(true);
    expect(events).toHaveLength(5);

    // The undo is the entry's latest event, so the UI can show it was taken back.
    expect(p.entries.get(1)!.lastEvent).toBe(events[4]!.id);

    // Relaunch: the projection must equal a full replay of the log.
    expect(checkInvariants(sampleList, events, project(sampleList, events))).toEqual([]);
    replayWithInvariants(events);
  });

  it('will not offer to undo an already-undone action', () => {
    fresh();
    const confirm = ev('item_confirmed_scan', 1, { productId: 1 });
    const events = [confirm, ev('undo', 1, {}, confirm.id)];
    expect(undoTarget(1, events)).toBeUndefined();
  });

  it('restores quantity without deleting the change', () => {
    fresh();
    const change = ev('quantity_changed', 5, { quantity: 4 });
    const events = [change];
    expect(project(sampleList, events).entries.get(5)!.quantity).toBe(4);
    events.push(ev('undo', 5, {}, change.id));
    expect(project(sampleList, events).entries.get(5)!.quantity).toBe(2);
    expect(events).toHaveLength(2);
  });
});

describe('review and finish', () => {
  it('reports pending and skipped entries as unresolved', () => {
    fresh();
    const events = [
      ...sampleList.slice(0, 8).map((e) => ev('item_confirmed_scan', e.id, { productId: e.acceptedProducts[0] })),
      ev('item_skipped', 9),
    ];
    const p = project(sampleList, events);
    const unresolved = unresolvedEntries(p).map((e) => e.entryId).sort((a, b) => a - b);
    expect(unresolved).toEqual([9, 10]); // the skipped ice cream and the unrouted card
    replayWithInvariants(events);
  });

  it('counts substitutions as obtained and keeps the substituted product', () => {
    fresh();
    const events = [ev('item_substituted', 4, { productId: 6, barcode: '4011000000006' })];
    const p = project(sampleList, events);
    expect(p.entries.get(4)!.status).toBe('substituted');
    expect(p.entries.get(4)!.productId).toBe(6);
    expect(isUnresolved(p.entries.get(4)!.status)).toBe(false);
  });
});

describe('pause, resume and interruption', () => {
  it('survives a kill at every step boundary', () => {
    fresh();
    const events = [
      ev('trip_started'),
      ev('location_confirmed', undefined, { node: 1 }),
      ev('checkin_manual', undefined, { node: 13, aisleLabel: '3' }),
      ev('item_confirmed_scan', 4, { productId: 5, barcode: '4011000000005' }),
      ev('paused'),
      ev('resumed'),
      ev('item_skipped', 9),
      ev('help_requested', 9, { reason: 'asked staff' }),
      ev('recognition_abstained', 9, { mode: 'find' }),
    ];
    replayWithInvariants(events);
    const p = project(sampleList, events);
    expect(p.paused).toBe(false);
    expect(p.confirmedNode).toBe(13);
    expect(p.entries.get(4)!.status).toBe('collected');
  });

  it('detects a projection that has drifted from the log', () => {
    fresh();
    const events = [ev('item_confirmed_scan', 1, { productId: 1 })];
    const p = project(sampleList, events);
    p.entries.get(1)!.status = 'skipped'; // simulate a corrupted cache
    const violations = checkInvariants(sampleList, events, p);
    expect(violations.some((v) => v.includes('status drift'))).toBe(true);
  });

  it('rejects a log whose undo points at a missing event', () => {
    fresh();
    const events = [ev('undo', 1, {}, 999)];
    const violations = checkInvariants(sampleList, events, project(sampleList, events));
    expect(violations.some((v) => v.includes('targets missing event'))).toBe(true);
  });
});
