import { describe, expect, it } from 'vitest';
import { mergeMasterEvent, type MasterRecord } from './conflict';
import {
  BRANCH_A,
  BRANCH_B,
  BRANCH_HO,
  DEVICE_A,
  DEVICE_B,
  DEVICE_HO,
  event,
  site,
} from './test-events';

const PRICE = new Set(['retailRateUnitMicro']);
const branchCtx = { headOffice: false, priceFields: PRICE };
const hoCtx = { headOffice: true, priceFields: PRICE };

const a = site(BRANCH_A, DEVICE_A);
const b = site(BRANCH_B, DEVICE_B);
const ho = site(BRANCH_HO, DEVICE_HO, true);

function created(name: string, price: number): MasterRecord {
  const e = event(ho, 'items', 'item-1', 'insert', {
    id: 'item-1',
    name,
    retailRateUnitMicro: price,
    version: 1,
  });
  return mergeMasterEvent(null, e, hoCtx).record;
}

describe('master data merge', () => {
  it('a clean edit on the latest version wins with no conflict', () => {
    const base = created('Paracetamol 500', 1000);
    const e = event(a, 'items', 'item-1', 'update', {
      name: 'Paracetamol 500mg',
      baseVersion: base.version,
    });
    const out = mergeMasterEvent(base, e, branchCtx);
    expect(out.record.fields.name).toBe('Paracetamol 500mg');
    expect(out.record.version).toBe(base.version + 1);
    expect(out.conflicts).toEqual([]);
  });

  it('two branches renaming the same item: later HLC wins in either arrival order, loser is kept', () => {
    const base = created('Item', 1000);
    a.time.ms += 1000;
    const fromA = event(a, 'items', 'item-1', 'update', {
      name: 'Name from A',
      baseVersion: base.version,
    });
    b.time.ms += 5000; // B edited later
    const fromB = event(b, 'items', 'item-1', 'update', {
      name: 'Name from B',
      baseVersion: base.version,
    });

    const ab = mergeMasterEvent(mergeMasterEvent(base, fromA, branchCtx).record, fromB, branchCtx);
    const ba = mergeMasterEvent(mergeMasterEvent(base, fromB, branchCtx).record, fromA, branchCtx);

    expect(ab.record.fields.name).toBe('Name from B');
    expect(ba.record.fields.name).toBe('Name from B');
    expect(ab.conflicts).toHaveLength(1);
    expect(ab.conflicts[0]).toMatchObject({
      field: 'name',
      reason: 'last_writer_wins',
      loser: { value: 'Name from A' },
    });
    expect(ba.conflicts).toHaveLength(1);
    expect(ba.conflicts[0]).toMatchObject({ field: 'name', loser: { value: 'Name from A' } });
  });

  it('edits to different fields of the same item both survive', () => {
    const base = created('Item', 1000);
    const e1 = event(a, 'items', 'item-1', 'update', {
      genericName: 'Paracetamol',
      baseVersion: base.version,
    });
    const e2 = event(b, 'items', 'item-1', 'update', { rackId: 'R-7', baseVersion: base.version });
    const out = mergeMasterEvent(mergeMasterEvent(base, e1, branchCtx).record, e2, branchCtx);
    expect(out.record.fields).toMatchObject({ genericName: 'Paracetamol', rackId: 'R-7' });
  });

  it('an old update that arrives late does not overwrite a newer value (out-of-order delivery)', () => {
    const base = created('Item', 1000);
    const older = event(a, 'items', 'item-1', 'update', {
      name: 'Older',
      baseVersion: base.version,
    });
    a.time.ms += 60_000;
    const newer = event(a, 'items', 'item-1', 'update', {
      name: 'Newer',
      baseVersion: base.version + 1,
    });
    const afterNewer = mergeMasterEvent(base, newer, branchCtx).record;
    const out = mergeMasterEvent(afterNewer, older, branchCtx);
    expect(out.record.fields.name).toBe('Newer');
  });

  it('Head Office wins the price even when a branch clock is ahead', () => {
    const base = created('Item', 1000);
    b.time.ms += 3 * 24 * 3600 * 1000; // branch clock three days fast
    const branchEdit = event(b, 'items', 'item-1', 'update', {
      retailRateUnitMicro: 900,
      baseVersion: base.version,
    });
    const out = mergeMasterEvent(base, branchEdit, branchCtx);
    expect(out.record.fields.retailRateUnitMicro).toBe(1000);
    expect(out.conflicts[0]).toMatchObject({
      field: 'retailRateUnitMicro',
      reason: 'head_office_wins',
      loser: { value: 900 },
    });
  });

  it('a Head Office price change replaces an earlier branch price whatever the HLC order', () => {
    const start = mergeMasterEvent(
      null,
      event(b, 'items', 'item-2', 'insert', { id: 'item-2', name: 'X', retailRateUnitMicro: 500 }),
      branchCtx,
    ).record;
    const hoEdit = event(ho, 'items', 'item-2', 'update', {
      retailRateUnitMicro: 700,
      baseVersion: start.version,
    });
    ho.time.ms -= 10 * 24 * 3600 * 1000; // HO clock behind: still wins
    const out = mergeMasterEvent(start, hoEdit, hoCtx);
    expect(out.record.fields.retailRateUnitMicro).toBe(700);
  });

  it('a void marks the record and later edits do not resurrect it', () => {
    const base = created('Item', 1000);
    const voided = mergeMasterEvent(
      base,
      event(ho, 'items', 'item-1', 'void', { id: 'item-1' }),
      hoCtx,
    ).record;
    expect(voided.voided).toBe(true);
    const edited = mergeMasterEvent(
      voided,
      event(a, 'items', 'item-1', 'update', { name: 'Late', baseVersion: voided.version }),
      branchCtx,
    ).record;
    expect(edited.voided).toBe(true);
  });

  it('replaying the same event changes nothing', () => {
    const base = created('Item', 1000);
    const e = event(a, 'items', 'item-1', 'update', { name: 'Once', baseVersion: base.version });
    const once = mergeMasterEvent(base, e, branchCtx);
    const twice = mergeMasterEvent(once.record, e, branchCtx);
    expect(twice.record.fields).toEqual(once.record.fields);
  });
});
