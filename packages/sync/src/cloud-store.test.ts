import { describe, expect, it } from 'vitest';
import { MAX_BATCH_EVENTS, type DeviceAuth } from './cloud-store';
import { FakeCloud } from './fake-cloud';
import { CloudAuthError, StaleEpochError } from './outbox';
import {
  BRANCH_A,
  BRANCH_B,
  BRANCH_HO,
  DEVICE_A,
  DEVICE_B,
  DEVICE_HO,
  TENANT,
  event,
  site,
} from './test-events';

const NOW = Date.parse('2026-10-01T09:00:00Z');
const authA: DeviceAuth = {
  tenantId: TENANT,
  branchId: BRANCH_A,
  deviceId: DEVICE_A,
  headOffice: false,
};
const authB: DeviceAuth = {
  tenantId: TENANT,
  branchId: BRANCH_B,
  deviceId: DEVICE_B,
  headOffice: false,
};
const authHo: DeviceAuth = {
  tenantId: TENANT,
  branchId: BRANCH_HO,
  deviceId: DEVICE_HO,
  headOffice: true,
};

const a = site(BRANCH_A, DEVICE_A, false, NOW);
const b = site(BRANCH_B, DEVICE_B, false, NOW);

function setup() {
  const cloud = new FakeCloud({ now: () => NOW });
  return {
    cloud,
    connA: cloud.connect(authA),
    connB: cloud.connect(authB),
    connHo: cloud.connect(authHo),
  };
}

describe('cloud store rules', () => {
  it('applies an event once and answers duplicate afterwards', async () => {
    const { cloud, connA } = setup();
    const e = event(a, 'sales', 'sale-1', 'insert', { total: 100 });
    const first = await connA.push({ idempotencyKey: e.id, epoch: 1, events: [e] });
    const second = await connA.push({ idempotencyKey: e.id, epoch: 1, events: [e] });
    expect(first.results).toEqual([{ id: e.id, status: 'applied' }]);
    expect(second.results).toEqual([{ id: e.id, status: 'duplicate' }]);
    expect(cloud.store.appliedIds).toEqual([e.id]);
  });

  it('rejects an event that claims another branch, tenant or device', async () => {
    const { connA } = setup();
    const otherBranch = event(a, 'sales', 's1', 'insert', {}, { branchId: BRANCH_B });
    const otherTenant = event(
      a,
      'sales',
      's2',
      'insert',
      {},
      { tenantId: '99999999-9999-7999-8999-999999999999' },
    );
    const otherDevice = event(a, 'sales', 's3', 'insert', {}, { deviceId: DEVICE_B });
    const res = await connA.push({
      idempotencyKey: 'k',
      epoch: 1,
      events: [otherBranch, otherTenant, otherDevice],
    });
    expect(res.results.map((r) => (r.status === 'rejected' ? r.reason : r.status))).toEqual([
      'scope_mismatch_branch',
      'scope_mismatch_tenant',
      'scope_mismatch_device',
    ]);
  });

  it('accepts schema N and N-1 only up to the current version, and rejects malformed HLCs', async () => {
    const { connA } = setup();
    const tooNew = event(a, 'sales', 's1', 'insert', {}, { schemaVersion: 2 });
    const badHlc = event(a, 'sales', 's2', 'insert', {}, { hlc: 'nonsense' });
    const res = await connA.push({ idempotencyKey: 'k', epoch: 1, events: [tooNew, badHlc] });
    expect(res.results.map((r) => (r.status === 'rejected' ? r.reason : r.status))).toEqual([
      'schema_too_new',
      'invalid_hlc',
    ]);
  });

  it('accepts but flags an event from a clock more than 24 h ahead', async () => {
    const { cloud, connB } = setup();
    b.time.ms = NOW + 3 * 24 * 3600 * 1000;
    const e = event(b, 'sales', 'sale-skew', 'insert', { total: 1 });
    const res = await connB.push({ idempotencyKey: e.id, epoch: 1, events: [e] });
    expect(res.results[0]).toEqual({ id: e.id, status: 'applied', flags: ['clock_skew'] });
    expect(cloud.store.flagged.get(e.id)).toEqual(['clock_skew']);
    b.time.ms = NOW;
  });

  it('refuses a stale epoch and adopts a higher one', async () => {
    const { cloud, connA } = setup();
    const e1 = event(a, 'sales', 's1', 'insert', {});
    await connA.push({ idempotencyKey: e1.id, epoch: 2, events: [e1] }); // promoted server announces epoch 2
    expect(cloud.store.epochOf(authA)).toBe(2);
    const e2 = event(a, 'sales', 's2', 'insert', {});
    await expect(
      connA.push({ idempotencyKey: e2.id, epoch: 1, events: [e2] }),
    ).rejects.toBeInstanceOf(StaleEpochError);
    expect(cloud.store.appliedIds).toEqual([e1.id]); // the fenced push wrote nothing
  });

  it('an empty batch announces an epoch', async () => {
    const { cloud, connA } = setup();
    await connA.push({ idempotencyKey: 'epoch-3', epoch: 3, events: [] });
    expect(cloud.store.epochOf(authA)).toBe(3);
  });

  it('refuses oversized batches per event', async () => {
    const { connA } = setup();
    const events = Array.from({ length: MAX_BATCH_EVENTS + 1 }, (_, i) =>
      event(a, 'sales', `s${i}`, 'insert', {}),
    );
    const res = await connA.push({ idempotencyKey: 'big', epoch: 1, events });
    expect(res.results.every((r) => r.status === 'rejected')).toBe(true);
  });

  it('a revoked device gets an auth error', async () => {
    const { connA } = setup();
    connA.faults.revoked = true;
    await expect(connA.push({ idempotencyKey: 'k', epoch: 1, events: [] })).rejects.toBeInstanceOf(
      CloudAuthError,
    );
  });
});

describe('pull', () => {
  it('serves master data to other branches from a cursor, never echoes own events, and resumes', async () => {
    const { connA, connB, connHo } = setup();
    const names = ['One', 'Two', 'Three'].map((n, i) =>
      event(a, 'suppliers', `sup-${i}`, 'insert', { id: `sup-${i}`, name: n }),
    );
    await connA.push({ idempotencyKey: 'k', epoch: 1, events: names });

    const own = await connA.pull({ cursors: { suppliers: '0' }, limit: 10 });
    expect(own.changes).toHaveLength(0);
    expect(own.cursors.suppliers).toBe('3');

    const p1 = await connB.pull({ cursors: { suppliers: '0' }, limit: 2 });
    expect(p1.changes.map((c) => c.event.entityId)).toEqual(['sup-0', 'sup-1']);
    expect(p1.hasMore).toBe(true);
    const p2 = await connHo.pull({ cursors: { suppliers: p1.cursors.suppliers ?? '0' }, limit: 2 });
    expect(p2.changes.map((c) => c.event.entityId)).toEqual(['sup-2']);
    expect(p2.hasMore).toBe(false);
    expect(p2.changes[0]?.version).toBe(1);
  });

  it("does not hand one branch's sales to another, but delivers documents addressed to it", async () => {
    const { connA, connB } = setup();
    const sale = event(a, 'sales', 'sale-1', 'insert', { total: 5 });
    const transfer = event(a, 'transfers', 'tr-1', 'insert', { toBranchId: BRANCH_B });
    await connA.push({ idempotencyKey: 'k', epoch: 1, events: [sale, transfer] });
    const res = await connB.pull({ cursors: { sales: '0', transfers: '0' }, limit: 10 });
    expect(res.changes.map((c) => c.event.entityType)).toEqual(['transfers']);
  });
});
