import { count, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId, SYNC_SCHEMA_VERSION, type PulledChange } from '@mediescare/sync';
import { getBatchStock } from '../pharmacy/stock';
import { itemUnits, items, stockMovements, stockTransfers, syncOutbox } from '../schema/sqlite-all';
import { getApplier, type ApplyEnv } from '../sync/appliers/registry';
import { resetCursors } from '../sync/pull';
import {
  approveRequisition,
  cancelRequisition,
  createRequisition,
  getRequisition,
  listRequisitions,
} from './requisitions';
import {
  createTransfer,
  dispatchTransfer,
  getTransfer,
  listTransfers,
  receiveTransfer,
  transferAggregate,
} from './transfers';
import { createNetwork, stockUp, type Network, type Site } from './test-support';

let net: Network;

const stockOf = (site: Site, itemId: string) =>
  getBatchStock(site.env.db, site.branchId, itemId, { includeEmpty: true });
const onHand = (site: Site, itemId: string) =>
  stockOf(site, itemId).reduce((s, b) => s + b.available, 0);
const rows = (
  site: Site,
  table: typeof stockMovements | typeof syncOutbox | typeof stockTransfers,
) => site.env.db.select({ n: count() }).from(table).get()?.n ?? 0;

const envOf = (site: Site): ApplyEnv => ({
  tenantId: site.ctx.tenantId,
  branchId: site.branchId,
  isHeadOffice: site === net.ho,
});

/** Feeds one event straight to a registered applier, the way the change applier does. */
function applyEvent(
  site: Site,
  entityType: 'stock_transfers' | 'stock_requisitions',
  payload: unknown,
  from: Site,
) {
  const applier = getApplier(entityType);
  if (!applier) throw new Error('applier not registered');
  const change: PulledChange = {
    cursor: '1',
    version: null,
    event: {
      id: newId(),
      seq: 0,
      entityType,
      entityId: (payload as { id: string }).id,
      op: 'update',
      payload,
      hlc: from.ctx.clock.tick(),
      deviceId: from.ctx.deviceId,
      branchId: from.branchId,
      tenantId: from.ctx.tenantId,
      schemaVersion: SYNC_SCHEMA_VERSION,
    },
  };
  return site.env.db.transaction((tx) => applier(tx, change, envOf(site)));
}

beforeEach(async () => {
  net = await createNetwork();
  stockUp(net, [
    { itemId: net.para, batchNo: 'P0', expiryDate: '2027-06-30', strips: 20 },
    { itemId: net.amox, batchNo: 'M1', expiryDate: '2027-06-30', strips: 30 },
  ]);
});
afterEach(() => net.cleanup());

function shipParacetamol(qty = 50): string {
  const batchId = stockOf(net.ho, net.para)[0]!.id;
  const note = createTransfer(net.ho.env.db, net.ho.ctx, {
    toBranchId: net.branch.branchId,
    lines: [{ itemId: net.para, batchId, qtyBase: qty }],
  });
  dispatchTransfer(net.ho.env.db, net.ho.ctx, note.id);
  return note.id;
}

describe('transfer sync: duplicate and out-of-order delivery', () => {
  it('double delivery and a full re-pull change nothing', async () => {
    const { ho, branch } = net;
    branch.conn.faults.deliverTwice = true;
    ho.conn.faults.deliverTwice = true;
    const r = createRequisition(branch.env.db, branch.ctx, {
      lines: [{ itemId: net.para, qtyBase: 40 }],
    });
    await branch.sync();
    await ho.sync();
    approveRequisition(ho.env.db, ho.ctx, r.id);
    const id = shipParacetamol(40);
    await ho.sync();
    await branch.sync();
    receiveTransfer(branch.env.db, branch.ctx, id);
    await branch.sync();
    await ho.sync();

    // Everything is pulled again from the start: the appliers are idempotent.
    for (const s of [ho, branch]) {
      const before = {
        transfers: rows(s, stockTransfers),
        moves: rows(s, stockMovements),
        out: rows(s, syncOutbox),
      };
      resetCursors(s.env.db);
      await s.sync();
      await s.sync();
      expect({
        transfers: rows(s, stockTransfers),
        moves: rows(s, stockMovements),
        out: rows(s, syncOutbox),
      }).toEqual(before);
    }
    expect(listRequisitions(ho.env.db, ho.ctx).rows).toHaveLength(1);
    expect(getRequisition(ho.env.db, ho.ctx, r.id).status).toBe('approved'); // shipped on a direct note, not from it
    expect(getTransfer(ho.env.db, ho.ctx, id).status).toBe('received');
    expect(onHand(branch, net.para)).toBe(40);
    expect(onHand(ho, net.para)).toBe(200 - 40);
  });

  it('events delivered in reverse order still end in the right state', async () => {
    const { ho, branch } = net;
    // Branch: create then cancel a requisition; the cloud sees them cancel-first.
    branch.conn.faults.reverseBatches = true;
    const r = createRequisition(branch.env.db, branch.ctx, {
      lines: [{ itemId: net.amox, qtyBase: 10 }],
    });
    cancelRequisition(branch.env.db, branch.ctx, r.id, 'Not needed any more');
    await branch.sync();
    await ho.sync();
    expect(getRequisition(ho.env.db, ho.ctx, r.id)).toMatchObject({
      status: 'cancelled',
      cancelReason: 'Not needed any more',
    });

    // Head Office: draft and dispatch reach the cloud dispatch-first.
    ho.conn.faults.reverseBatches = true;
    const id = shipParacetamol(25);
    await ho.sync();
    await branch.sync();
    expect(getTransfer(branch.env.db, branch.ctx, id)).toMatchObject({
      status: 'dispatched',
      qtyDispatched: 25,
    });
    expect(listTransfers(branch.env.db, branch.ctx).rows).toHaveLength(1);
    expect(onHand(branch, net.para)).toBe(0);
  });

  it('an older state that arrives late is ignored, on both sides', async () => {
    const { ho, branch } = net;
    const id = shipParacetamol(30);
    const dispatchedPayload = JSON.parse(JSON.stringify(transferAggregate(ho.env.db, id)));
    await ho.sync();
    await branch.sync();
    receiveTransfer(branch.env.db, branch.ctx, id, {
      lines: [
        {
          lineId: transferAggregate(branch.env.db, id).lines[0]!.id,
          qtyReceived: 20,
          qtyDamaged: 4,
        },
      ],
    });
    const receivedPayload = JSON.parse(JSON.stringify(transferAggregate(branch.env.db, id)));
    await branch.sync();
    await ho.sync();
    expect(getTransfer(ho.env.db, ho.ctx, id)).toMatchObject({ status: 'received', qtyShort: 6 });

    // Late copies: the dispatch at the branch (already received) and at Head Office (already received).
    expect(applyEvent(branch, 'stock_transfers', dispatchedPayload, ho)).toMatchObject({
      outcome: 'skipped',
    });
    expect(applyEvent(ho, 'stock_transfers', receivedPayload, branch)).toMatchObject({
      outcome: 'skipped',
    });
    expect(applyEvent(ho, 'stock_transfers', dispatchedPayload, branch)).toMatchObject({
      outcome: 'skipped',
    });
    expect(getTransfer(branch.env.db, branch.ctx, id).status).toBe('received');
    expect(getTransfer(ho.env.db, ho.ctx, id).status).toBe('received');
    expect(onHand(branch, net.para)).toBe(20);
  });

  it('a receipt that arrives at a Head Office that has no record of the shipment is kept as a copy, no stock', async () => {
    const { ho, branch } = net;
    const id = shipParacetamol(10);
    await ho.sync();
    await branch.sync();
    receiveTransfer(branch.env.db, branch.ctx, id);
    const payload = JSON.parse(JSON.stringify(transferAggregate(branch.env.db, id)));
    // Pretend Head Office never had the row: change ids so it is a transfer it has not seen.
    const foreign = {
      ...payload,
      id: newId(),
      docNo: 'HO01-TRF-009999',
      lines: payload.lines.map((l: { id: string }) => ({ ...l, id: newId() })),
    };
    const moves = rows(ho, stockMovements);
    const out = rows(ho, syncOutbox);
    expect(applyEvent(ho, 'stock_transfers', foreign, branch)).toMatchObject({
      outcome: 'applied',
      created: true,
    });
    expect(rows(ho, stockMovements)).toBe(moves);
    expect(rows(ho, syncOutbox)).toBe(out);
    // A second delivery is a no-op.
    expect(applyEvent(ho, 'stock_transfers', foreign, branch)).toMatchObject({
      outcome: 'skipped',
    });
  });

  it('never applies a change meant for other branches, and never posts stock', () => {
    const { ho, branch } = net;
    const id = shipParacetamol(10);
    const payload = JSON.parse(JSON.stringify(transferAggregate(ho.env.db, id)));
    const stranger = { ...payload, id: newId(), toBranchId: newId() };
    const moves = rows(branch, stockMovements);
    expect(applyEvent(branch, 'stock_transfers', stranger, ho)).toMatchObject({
      outcome: 'skipped',
    });
    // Another organisation.
    expect(
      applyEvent(branch, 'stock_transfers', { ...payload, id: newId(), tenantId: newId() }, ho),
    ).toMatchObject({ outcome: 'skipped' });
    // A draft or cancelled note is private to the sender.
    expect(
      applyEvent(branch, 'stock_transfers', { ...payload, id: newId(), status: 'draft' }, ho),
    ).toMatchObject({ outcome: 'skipped' });
    // Garbage does not throw and does not block the feed.
    expect(applyEvent(branch, 'stock_transfers', { id: 'x' }, ho)).toMatchObject({
      outcome: 'skipped',
    });
    expect(applyEvent(branch, 'stock_requisitions', 'not an object', ho)).toMatchObject({
      outcome: 'skipped',
    });
    expect(rows(branch, stockMovements)).toBe(moves);
    expect(listTransfers(branch.env.db, branch.ctx).rows).toHaveLength(0);
  });

  it('waits (DependencyMissing) for an item that has not arrived, then applies it', async () => {
    const { ho, branch } = net;
    // The branch has not received the item yet.
    const savedItem = branch.env.db.select().from(items).where(eq(items.id, net.para)).get()!;
    const savedUnits = branch.env.db
      .select()
      .from(itemUnits)
      .where(eq(itemUnits.itemId, net.para))
      .all();
    branch.env.db.delete(itemUnits).where(eq(itemUnits.itemId, net.para)).run();
    branch.env.db.delete(items).where(eq(items.id, net.para)).run();

    const id = shipParacetamol(10);
    await ho.sync();
    await branch.sync();
    expect(listTransfers(branch.env.db, branch.ctx).rows).toHaveLength(0);

    // The item arrives. The next cycle applies the waiting transfer: nothing was lost.
    branch.env.db.insert(items).values(savedItem).run();
    branch.env.db.insert(itemUnits).values(savedUnits).run();
    await branch.sync();
    expect(getTransfer(branch.env.db, branch.ctx, id).status).toBe('dispatched');
  });

  it('the branch can receive while offline and Head Office catches up later', async () => {
    const { ho, branch } = net;
    const id = shipParacetamol(60);
    await ho.sync();
    await branch.sync();
    branch.conn.faults.offline = true;
    receiveTransfer(branch.env.db, branch.ctx, id, { note: 'Counted during an outage' });
    await branch.sync(); // fails quietly: the branch keeps working
    expect(onHand(branch, net.para)).toBe(60);
    await ho.sync();
    expect(getTransfer(ho.env.db, ho.ctx, id).status).toBe('dispatched'); // still in transit on HO's books

    net.advance(3 * 24 * 3600_000);
    branch.conn.faults.offline = false;
    branch.runner.nudge();
    await branch.sync();
    await ho.sync();
    expect(getTransfer(ho.env.db, ho.ctx, id)).toMatchObject({
      status: 'received',
      receiveNote: 'Counted during an outage',
    });
  });
});
