import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  MAX_BATCH_EVENTS,
  MAX_EVENT_PAYLOAD_CHARS,
  type CloudStore,
  type DeviceAuth,
} from './cloud-store';
import { StaleEpochError, type EventResult, type PushRequest } from './outbox';
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

/**
 * One contract, every `CloudStore`. The in-memory store and the PostgreSQL store (PGlite, and a real
 * database when one is reachable) must behave identically, so they all run this suite. Cursors are
 * opaque: only their order and "feed them back" semantics are asserted, never their numbers.
 */
export interface ContractHarness {
  store: CloudStore;
  /** Make a device known to the store and return the access token that authenticates it. */
  register(auth: DeviceAuth): Promise<string>;
  revoke(auth: DeviceAuth): Promise<void>;
  epochOf(auth: DeviceAuth): Promise<number>;
  /** Number of distinct events the store holds. */
  countEvents(): Promise<number>;
  master(
    entityType: string,
    entityId: string,
  ): Promise<{ fields: Record<string, unknown>; version: number; voided: boolean } | null>;
  conflicts(): Promise<{ entityType: string; entityId: string; field: string; reason: string }[]>;
  close(): Promise<void>;
}

export const CONTRACT_NOW = Date.parse('2026-10-01T09:00:00Z');

const authOf = (branchId: string, deviceId: string, headOffice: boolean): DeviceAuth => ({
  tenantId: TENANT,
  branchId,
  deviceId,
  headOffice,
});
const OTHER_TENANT = '99999999-9999-7999-8999-999999999999';

const reasons = (results: EventResult[]) =>
  results.map((r) => (r.status === 'rejected' ? r.reason : r.status));

export function runCloudStoreContract(
  name: string,
  create: (now: () => number) => Promise<ContractHarness>,
): void {
  describe(`cloud store contract: ${name}`, () => {
    const authA = authOf(BRANCH_A, DEVICE_A, false);
    const authB = authOf(BRANCH_B, DEVICE_B, false);
    const authHo = authOf(BRANCH_HO, DEVICE_HO, true);
    let h: ContractHarness;
    let store: CloudStore;
    let a: ReturnType<typeof site>;
    let b: ReturnType<typeof site>;
    let ho: ReturnType<typeof site>;

    beforeEach(async () => {
      h = await create(() => CONTRACT_NOW);
      store = h.store;
      await h.register(authHo);
      await h.register(authA);
      await h.register(authB);
      a = site(BRANCH_A, DEVICE_A, false, CONTRACT_NOW);
      b = site(BRANCH_B, DEVICE_B, false, CONTRACT_NOW);
      ho = site(BRANCH_HO, DEVICE_HO, true, CONTRACT_NOW);
    });
    afterEach(async () => {
      await h.close();
    });

    const push = (auth: DeviceAuth, events: PushRequest['events'], epoch = 1, key?: string) =>
      store.applyBatch(auth, { idempotencyKey: key ?? events[0]?.id ?? 'k', epoch, events });

    describe('authentication', () => {
      it('resolves a registered token to its device and rejects unknown and revoked ones', async () => {
        const token = await h.register(authA);
        expect(await store.authenticate(token)).toEqual(authA);
        expect(await store.authenticate('not-a-real-token-0123456789')).toBeNull();
        await h.revoke(authA);
        expect(await store.authenticate(token)).toBeNull();
      });

      it('marks only the Head Office device as headOffice', async () => {
        const t = await h.register(authHo);
        expect((await store.authenticate(t))?.headOffice).toBe(true);
      });
    });

    describe('push', () => {
      it('applies an event once and answers duplicate afterwards', async () => {
        const e = event(a, 'sales', 'sale-1', 'insert', { total: 100 });
        const first = await push(authA, [e]);
        const second = await push(authA, [e]);
        expect(first.results).toEqual([{ id: e.id, status: 'applied' }]);
        expect(second.results).toEqual([{ id: e.id, status: 'duplicate' }]);
        expect(await h.countEvents()).toBe(1);
      });

      it('is idempotent by batch key and by event id when a batch is resent with extra events', async () => {
        const e1 = event(a, 'sales', 's1', 'insert', {});
        const e2 = event(a, 'sales', 's2', 'insert', {});
        await push(authA, [e1], 1, 'batch-1');
        const again = await push(authA, [e1, e2], 1, 'batch-1');
        expect(reasons(again.results)).toEqual(['duplicate', 'applied']);
        expect(await h.countEvents()).toBe(2);
      });

      it('answers duplicate for the second copy of an event inside one batch', async () => {
        const e = event(a, 'sales', 's1', 'insert', {});
        const res = await push(authA, [e, e]);
        expect(reasons(res.results)).toEqual(['applied', 'duplicate']);
        expect(await h.countEvents()).toBe(1);
      });

      it('rejects an event that claims another branch, tenant or device', async () => {
        const res = await push(authA, [
          event(a, 'sales', 's1', 'insert', {}, { branchId: BRANCH_B }),
          event(a, 'sales', 's2', 'insert', {}, { tenantId: OTHER_TENANT }),
          event(a, 'sales', 's3', 'insert', {}, { deviceId: DEVICE_B }),
        ]);
        expect(reasons(res.results)).toEqual([
          'scope_mismatch_branch',
          'scope_mismatch_tenant',
          'scope_mismatch_device',
        ]);
        expect(await h.countEvents()).toBe(0);
      });

      it('accepts schema N and N-1 only, and rejects malformed HLCs', async () => {
        const res = await push(authA, [
          event(a, 'sales', 's1', 'insert', {}, { schemaVersion: 2 }),
          event(a, 'sales', 's2', 'insert', {}, { hlc: 'nonsense' }),
        ]);
        expect(reasons(res.results)).toEqual(['schema_too_new', 'invalid_hlc']);
      });

      it('rejects oversized and NUL-carrying payloads without failing the rest of the batch', async () => {
        const big = event(a, 'sales', 'big', 'insert', {
          blob: 'x'.repeat(MAX_EVENT_PAYLOAD_CHARS),
        });
        const nul = event(a, 'sales', 'nul', 'insert', { note: `a${String.fromCharCode(0)}b` });
        const nulId = event(a, 'sales', `x${String.fromCharCode(0)}y`, 'insert', {});
        const fine = event(a, 'sales', 'fine', 'insert', { total: 1 });
        const res = await push(authA, [big, nul, nulId, fine]);
        expect(reasons(res.results)).toEqual([
          'payload_too_large',
          'invalid_payload',
          'invalid_identifier',
          'applied',
        ]);
        expect(await h.countEvents()).toBe(1);
      });

      it('stores unusual but valid payloads unchanged', async () => {
        const payload = {
          text: 'Paracetamol 500 mg – دوا',
          n: 12345678901234,
          nested: { list: [1, 'two', null, true], empty: {} },
        };
        const e = event(b, 'suppliers', 'sup-1', 'insert', { id: 'sup-1', ...payload });
        await push(authB, [e]);
        const pulled = await store.pull(authA, { cursors: { suppliers: '0' }, limit: 10 });
        expect(pulled.changes[0]?.event.payload).toEqual({ id: 'sup-1', ...payload });
        expect(pulled.changes[0]?.event.id).toBe(e.id);
        expect(pulled.changes[0]?.event.hlc).toBe(e.hlc);
      });

      it('accepts but flags an event from a clock more than 24 h ahead', async () => {
        b.time.ms = CONTRACT_NOW + 3 * 24 * 3600 * 1000;
        const e = event(b, 'sales', 'sale-skew', 'insert', { total: 1 });
        const res = await push(authB, [e]);
        expect(res.results[0]).toEqual({ id: e.id, status: 'applied', flags: ['clock_skew'] });
      });

      it('refuses a stale epoch, writes nothing for it, and adopts a higher one', async () => {
        const e1 = event(a, 'sales', 's1', 'insert', {});
        await push(authA, [e1], 2);
        expect(await h.epochOf(authA)).toBe(2);
        const e2 = event(a, 'sales', 's2', 'insert', {});
        await expect(push(authA, [e2], 1)).rejects.toBeInstanceOf(StaleEpochError);
        expect(await h.countEvents()).toBe(1);
        // Epochs are per branch: another branch is unaffected.
        const res = await push(authB, [event(b, 'sales', 's3', 'insert', {})], 1);
        expect(reasons(res.results)).toEqual(['applied']);
      });

      it('an empty batch announces an epoch', async () => {
        await push(authA, [], 3, 'epoch-3');
        expect(await h.epochOf(authA)).toBe(3);
      });

      it('refuses oversized batches per event', async () => {
        const events = Array.from({ length: MAX_BATCH_EVENTS + 1 }, (_, i) =>
          event(a, 'sales', `s${i}`, 'insert', {}),
        );
        const res = await push(authA, events, 1, 'big');
        expect(res.results.every((r) => r.status === 'rejected')).toBe(true);
        expect(await h.countEvents()).toBe(0);
      });

      it('takes a full batch of 500 events', async () => {
        const events = Array.from({ length: MAX_BATCH_EVENTS }, (_, i) =>
          event(a, 'sales', `s${i}`, 'insert', { i }),
        );
        const res = await push(authA, events);
        expect(res.results.filter((r) => r.status === 'applied')).toHaveLength(MAX_BATCH_EVENTS);
        expect(await h.countEvents()).toBe(MAX_BATCH_EVENTS);
      });
    });

    describe('pull', () => {
      it('serves master data to other branches from a cursor, never echoes own events, and resumes', async () => {
        const names = ['One', 'Two', 'Three'].map((n, i) =>
          event(a, 'suppliers', `sup-${i}`, 'insert', { id: `sup-${i}`, name: n }),
        );
        await push(authA, names);

        const own = await store.pull(authA, { cursors: { suppliers: '0' }, limit: 10 });
        expect(own.changes).toHaveLength(0);
        expect(own.hasMore).toBe(false);

        const p1 = await store.pull(authB, { cursors: { suppliers: '0' }, limit: 2 });
        expect(p1.changes.map((c) => c.event.entityId)).toEqual(['sup-0', 'sup-1']);
        expect(p1.hasMore).toBe(true);
        const p2 = await store.pull(authHo, {
          cursors: { suppliers: p1.cursors.suppliers ?? '0' },
          limit: 2,
        });
        expect(p2.changes.map((c) => c.event.entityId)).toEqual(['sup-2']);
        expect(p2.hasMore).toBe(false);
        expect(p2.changes[0]?.version).toBe(1);

        // Nothing new: the cursor stays where it is and a second pull is empty.
        const p3 = await store.pull(authHo, {
          cursors: { suppliers: p2.cursors.suppliers ?? '0' },
          limit: 2,
        });
        expect(p3.changes).toHaveLength(0);
        expect(p3.cursors.suppliers).toBe(p2.cursors.suppliers);
      });

      it('cursors are monotonic: a later push appears exactly once after the saved cursor', async () => {
        await push(authA, [event(a, 'suppliers', 'sup-1', 'insert', { id: 'sup-1', name: 'One' })]);
        const first = await store.pull(authB, { cursors: { suppliers: '0' }, limit: 10 });
        expect(first.changes).toHaveLength(1);
        await push(authHo, [
          event(ho, 'suppliers', 'sup-2', 'insert', { id: 'sup-2', name: 'Two' }),
        ]);
        await push(authA, [
          event(a, 'suppliers', 'sup-3', 'insert', { id: 'sup-3', name: 'Three' }),
        ]);
        const second = await store.pull(authB, { cursors: first.cursors, limit: 10 });
        expect(second.changes.map((c) => c.event.entityId)).toEqual(['sup-2', 'sup-3']);
        const third = await store.pull(authB, { cursors: second.cursors, limit: 10 });
        expect(third.changes).toHaveLength(0);
      });

      it('only returns the requested entity types, each with its own cursor', async () => {
        await push(authA, [
          event(a, 'suppliers', 'sup-1', 'insert', { id: 'sup-1', name: 'One' }),
          event(a, 'customers', 'cus-1', 'insert', { id: 'cus-1', name: 'Walk-in' }),
        ]);
        const res = await store.pull(authB, { cursors: { customers: '0' }, limit: 10 });
        expect(res.changes.map((c) => c.event.entityType)).toEqual(['customers']);
        expect(Object.keys(res.cursors)).toEqual(['customers']);
        const both = await store.pull(authB, {
          cursors: { customers: '0', suppliers: '0' },
          limit: 10,
        });
        expect(both.changes.map((c) => c.event.entityType).sort()).toEqual([
          'customers',
          'suppliers',
        ]);
      });

      it("does not hand one branch's sales to another, but delivers documents addressed to it", async () => {
        await push(authA, [
          event(a, 'sales', 'sale-1', 'insert', { total: 5 }),
          event(a, 'transfers', 'tr-1', 'insert', { toBranchId: BRANCH_B }),
          event(a, 'transfers', 'tr-2', 'insert', { toBranchId: BRANCH_HO }),
        ]);
        const res = await store.pull(authB, { cursors: { sales: '0', transfers: '0' }, limit: 10 });
        expect(res.changes.map((c) => c.event.entityId)).toEqual(['tr-1']);
        const own = await store.pull(authHo, {
          cursors: { sales: '0', transfers: '0' },
          limit: 10,
        });
        expect(own.changes.map((c) => c.event.entityId)).toEqual(['tr-2']);
      });

      it('never crosses tenants', async () => {
        const stranger: DeviceAuth = {
          tenantId: OTHER_TENANT,
          branchId: '88888888-8888-7888-8888-888888888888',
          deviceId: '55555555-5555-7555-8555-555555559999',
          headOffice: true,
        };
        await h.register(stranger);
        await push(authA, [event(a, 'suppliers', 'sup-1', 'insert', { id: 'sup-1', name: 'One' })]);
        const res = await store.pull(stranger, { cursors: { suppliers: '0' }, limit: 10 });
        expect(res.changes).toHaveLength(0);
      });

      it('returns documents and master data of one batch in push order', async () => {
        const events = [
          event(a, 'suppliers', 'sup-1', 'insert', { id: 'sup-1', name: 'One' }),
          event(a, 'suppliers', 'sup-2', 'insert', { id: 'sup-2', name: 'Two' }),
          event(a, 'suppliers', 'sup-1', 'update', { id: 'sup-1', name: 'One B', baseVersion: 1 }),
        ];
        await push(authA, events);
        const res = await store.pull(authB, { cursors: { suppliers: '0' }, limit: 10 });
        expect(res.changes.map((c) => c.event.id)).toEqual(events.map((e) => e.id));
        expect(res.changes.map((c) => c.version)).toEqual([1, 1, 2]);
      });
    });

    describe('master data merge', () => {
      it('treats branches as master data, so every branch learns the Head Office branch row', async () => {
        await push(authHo, [
          event(ho, 'branches', BRANCH_HO, 'insert', {
            id: BRANCH_HO,
            code: 'HO01',
            name: 'Head Office',
          }),
        ]);
        const res = await store.pull(authB, { cursors: { branches: '0' }, limit: 10 });
        expect(res.changes.map((c) => c.event.entityId)).toEqual([BRANCH_HO]);
        expect(res.changes[0]?.version).toBe(1);
        expect((await h.master('branches', BRANCH_HO))?.fields).toMatchObject({ code: 'HO01' });
      });

      it('keeps both branches edits to different fields and counts versions', async () => {
        await push(authA, [
          event(a, 'suppliers', 'sup-1', 'insert', { id: 'sup-1', name: 'One', phone: '1' }),
        ]);
        await push(authB, [
          event(b, 'suppliers', 'sup-1', 'update', { id: 'sup-1', phone: '2', baseVersion: 1 }),
        ]);
        await push(authA, [
          event(a, 'suppliers', 'sup-1', 'update', { id: 'sup-1', name: 'One B', baseVersion: 2 }),
        ]);
        const m = await h.master('suppliers', 'sup-1');
        expect(m?.fields).toEqual({ name: 'One B', phone: '2' });
        expect(m?.version).toBe(3);
        expect(await h.conflicts()).toEqual([]);
      });

      it('last writer wins on the same field and keeps a conflict note', async () => {
        await push(authA, [
          event(a, 'suppliers', 'sup-1', 'insert', { id: 'sup-1', name: 'Base' }),
        ]);
        a.time.ms += 1000;
        b.time.ms += 2000;
        await push(authA, [
          event(a, 'suppliers', 'sup-1', 'update', { id: 'sup-1', name: 'From A' }),
        ]);
        await push(authB, [
          event(b, 'suppliers', 'sup-1', 'update', { id: 'sup-1', name: 'From B' }),
        ]);
        expect((await h.master('suppliers', 'sup-1'))?.fields.name).toBe('From B');
        const conflicts = await h.conflicts();
        expect(conflicts.map((c) => `${c.field}:${c.reason}`)).toContain('name:last_writer_wins');
      });

      it('is order independent for two concurrent edits', async () => {
        await push(authA, [
          event(a, 'suppliers', 'sup-1', 'insert', { id: 'sup-1', name: 'Base' }),
        ]);
        a.time.ms += 1000;
        b.time.ms += 2000;
        const ea = event(a, 'suppliers', 'sup-1', 'update', { id: 'sup-1', name: 'From A' });
        const eb = event(b, 'suppliers', 'sup-1', 'update', { id: 'sup-1', name: 'From B' });
        await push(authB, [eb]);
        await push(authA, [ea]);
        expect((await h.master('suppliers', 'sup-1'))?.fields.name).toBe('From B');
      });

      it('Head Office wins price-policy fields whatever the clocks say', async () => {
        await push(authHo, [
          event(ho, 'items', 'item-1', 'insert', {
            id: 'item-1',
            name: 'Panadol',
            retailRateUnitMicro: 100,
          }),
        ]);
        b.time.ms += 60_000; // the branch clock is later
        await push(authB, [
          event(b, 'items', 'item-1', 'update', {
            id: 'item-1',
            retailRateUnitMicro: 999,
            name: 'Panadol B',
          }),
        ]);
        const m = await h.master('items', 'item-1');
        expect(m?.fields.retailRateUnitMicro).toBe(100);
        expect(m?.fields.name).toBe('Panadol B');
        expect((await h.conflicts()).map((c) => c.reason)).toContain('head_office_wins');
      });

      it('a void marks the entity voided and still appears in the feed', async () => {
        await push(authA, [event(a, 'suppliers', 'sup-1', 'insert', { id: 'sup-1', name: 'One' })]);
        await push(authA, [event(a, 'suppliers', 'sup-1', 'void', { id: 'sup-1' })]);
        expect((await h.master('suppliers', 'sup-1'))?.voided).toBe(true);
        const res = await store.pull(authB, { cursors: { suppliers: '0' }, limit: 10 });
        expect(res.changes.map((c) => c.event.op)).toEqual(['insert', 'void']);
      });
    });
  });
}
