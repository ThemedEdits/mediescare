import { count, eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hiddenFields, stripFields, type AccessContext } from '@mediescare/core';
import { DomainError } from '../errors';
import { getBatchStock } from '../pharmacy/stock';
import { batches, stockMovements, stockTransfers, syncOutbox } from '../schema/sqlite-all';
import { verifyAuditChain } from '../audit';
import {
  approveRequisition,
  createRequisition,
  getRequisition,
  listRequisitions,
} from './requisitions';
import {
  cancelTransfer,
  createTransfer,
  dispatchTransfer,
  getTransfer,
  listTransfers,
  receiveTransfer,
  suggestTransferBatches,
} from './transfers';
import { interBranchPosition, transferReconciliation, verifyStockLedger } from './transfer-reports';
import { createNetwork, stockUp, type Network, type Site } from './test-support';

let net: Network;

const stockOf = (site: Site, itemId: string) =>
  getBatchStock(site.env.db, site.branchId, itemId, { includeEmpty: true });
const onHand = (site: Site, itemId: string) =>
  stockOf(site, itemId).reduce((s, b) => s + b.available, 0);
const outboxCount = (site: Site) =>
  site.env.db.select({ n: count() }).from(syncOutbox).get()?.n ?? 0;

/** Runs raw SQL and surfaces the trigger's message (drizzle wraps the SQLite error). */
function runSql(site: Site, statement: string): void {
  try {
    site.env.db.run(sql.raw(statement));
  } catch (e) {
    throw new Error(((e as Error).cause as Error | undefined)?.message ?? (e as Error).message, {
      cause: e,
    });
  }
}

async function expectDomain(fn: () => unknown, code: string) {
  let err: unknown;
  try {
    await fn();
  } catch (e) {
    err = e;
  }
  expect(err, `expected DomainError ${code}`).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
}

beforeEach(async () => {
  net = await createNetwork();
  // Head Office stock. P0 expires first. Cost per tablet: P0 1.80, P1 2.00, M1 2.00.
  stockUp(net, [
    { itemId: net.para, batchNo: 'P1', expiryDate: '2027-01-31', strips: 20, priceStrip: '20' },
    { itemId: net.para, batchNo: 'P0', expiryDate: '2026-12-31', strips: 10, priceStrip: '18' },
    { itemId: net.amox, batchNo: 'M1', expiryDate: '2027-03-31', strips: 30, priceStrip: '20' },
  ]);
});
afterEach(() => net.cleanup());

describe('Head Office to branch transfer: the full cycle through two databases and a cloud', () => {
  it('requisition, approval, note, dispatch, receipt with damage and shortage, reconciled at both ends', async () => {
    const { ho, branch } = net;

    // 1. The branch asks.
    const req = createRequisition(branch.env.db, branch.ctx, {
      note: 'Weekly indent',
      lines: [
        { itemId: net.para, qtyBase: 100 },
        { itemId: net.amox, qtyBase: 50 },
      ],
    });
    expect(req.docNo).toBe('KHI02-REQ-000001');
    await branch.sync();
    await ho.sync();
    const atHo = listRequisitions(ho.env.db, ho.ctx).rows;
    expect(atHo).toHaveLength(1);
    expect(atHo[0]).toMatchObject({
      docNo: req.docNo,
      status: 'submitted',
      incoming: true,
      lineCount: 2,
    });

    // 2. Head Office approves and lowers paracetamol to 80.
    const detail = getRequisition(ho.env.db, ho.ctx, req.id);
    const paraLine = detail.lines.find((l) => l.item.id === net.para);
    approveRequisition(ho.env.db, ho.ctx, req.id, {
      lines: [{ lineId: paraLine!.id, qtyApprovedBase: 80 }],
    });
    await ho.sync();
    await branch.sync();
    const back = getRequisition(branch.env.db, branch.ctx, req.id);
    expect(back.status).toBe('approved');
    expect(back.lines.map((l) => l.qtyApprovedBase).sort()).toEqual([50, 80]);

    // 3. Transfer note: first-expiry-first picks P0 for paracetamol.
    const note = createTransfer(ho.env.db, ho.ctx, { requisitionId: req.id });
    expect(note.docNo).toBe('HO01-TRF-000001');
    const draft = getTransfer(ho.env.db, ho.ctx, note.id);
    expect(draft.status).toBe('draft');
    expect(draft.lines.find((l) => l.item.id === net.para)).toMatchObject({
      batchNo: 'P0',
      qtyDispatched: 80,
    });
    expect(draft.cost.dispatchedMinor).toBe(14_400 + 10_000); // 80 x 1.80 + 50 x 2.00
    expect(onHand(ho, net.para)).toBe(300); // nothing left the ledger yet

    // 4. Dispatch: stock leaves Head Office, nothing appears at the branch, the goods are in transit.
    dispatchTransfer(ho.env.db, ho.ctx, note.id);
    expect(onHand(ho, net.para)).toBe(300 - 80);
    expect(onHand(ho, net.amox)).toBe(300 - 50);
    const out = ho.env.db
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.docId, note.id))
      .all();
    expect(out.every((m) => m.kind === 'transfer_out' && m.qtyBase < 0)).toBe(true);
    expect(getRequisition(ho.env.db, ho.ctx, req.id).status).toBe('fulfilled');

    await ho.sync();
    const branchMovementsBefore = branch.env.db
      .select({ n: count() })
      .from(stockMovements)
      .get()?.n;
    const outboxBefore = outboxCount(branch);
    await branch.sync();
    expect(outboxCount(branch)).toBe(outboxBefore); // a pull never writes the outbox
    expect(branch.env.db.select({ n: count() }).from(stockMovements).get()?.n).toBe(
      branchMovementsBefore,
    );
    expect(onHand(branch, net.para)).toBe(0);
    expect(onHand(branch, net.amox)).toBe(0);
    expect(getRequisition(branch.env.db, branch.ctx, req.id).status).toBe('fulfilled');

    const incoming = listTransfers(branch.env.db, branch.ctx, { direction: 'incoming' }).rows;
    expect(incoming).toHaveLength(1);
    expect(incoming[0]).toMatchObject({
      docNo: note.docNo,
      status: 'dispatched',
      qtyDispatched: 130,
    });

    // In transit shows on both positions and nobody's stock.
    const hoPos = interBranchPosition(ho.env.db, ho.ctx).totals.shipper.cost;
    const brPos = interBranchPosition(branch.env.db, branch.ctx).totals.receiver.cost;
    for (const p of [hoPos, brPos])
      expect(p).toMatchObject({
        dispatchedMinor: 24_400,
        inTransitMinor: 24_400,
        receivedMinor: 0,
        differenceMinor: 0,
      });

    // 5. The branch counts: paracetamol 70 good, 5 damaged, 5 short. Amoxicillin all good (default).
    const brDetail = getTransfer(branch.env.db, branch.ctx, note.id);
    const brPara = brDetail.lines.find((l) => l.item.id === net.para)!;
    const receipt = receiveTransfer(branch.env.db, branch.ctx, note.id, {
      lines: [{ lineId: brPara.id, qtyReceived: 70, qtyDamaged: 5 }],
      note: 'Box crushed in transit',
    });
    expect(receipt).toMatchObject({ receivedQty: 120, damagedQty: 5, shortQty: 5 });
    expect(onHand(branch, net.para)).toBe(70); // good units only
    expect(onHand(branch, net.amox)).toBe(50);
    const branchBatch = stockOf(branch, net.para)[0]!;
    expect(branchBatch).toMatchObject({ batchNo: 'P0', expiryDate: '2026-12-31' });
    expect(branchBatch.costUnitMicro).toBe(1_800_000); // the transfer cost, no margin
    expect(onHand(ho, net.para)).toBe(220); // the receipt does not touch Head Office stock

    const received = getTransfer(branch.env.db, branch.ctx, note.id);
    expect(received.status).toBe('received');
    expect(received.cost).toEqual({
      dispatchedMinor: 24_400,
      receivedMinor: 12_600 + 10_000,
      damagedMinor: 900,
      shortMinor: 900,
    });
    const brAfter = interBranchPosition(branch.env.db, branch.ctx).totals.receiver.cost;
    expect(brAfter).toMatchObject({
      inTransitMinor: 0,
      differenceMinor: 0,
      damagedMinor: 900,
      shortMinor: 900,
    });

    // 6. Head Office sees the receipt after sync, and its books add up to zero difference too.
    expect(interBranchPosition(ho.env.db, ho.ctx).totals.shipper.cost.inTransitMinor).toBe(24_400);
    await branch.sync();
    const hoOutboxBefore = outboxCount(ho);
    await ho.sync();
    expect(outboxCount(ho)).toBe(hoOutboxBefore);
    const atHoAfter = getTransfer(ho.env.db, ho.ctx, note.id);
    expect(atHoAfter.status).toBe('received');
    expect(atHoAfter.cost).toEqual(received.cost);
    expect(atHoAfter.lines.find((l) => l.item.id === net.para)).toMatchObject({
      qtyReceived: 70,
      qtyDamaged: 5,
      qtyShort: 5,
    });
    expect(onHand(ho, net.para)).toBe(220);
    const hoAfter = interBranchPosition(ho.env.db, ho.ctx);
    expect(hoAfter.totals.shipper.cost).toMatchObject({
      dispatchedMinor: 24_400,
      receivedMinor: 22_600,
      inTransitMinor: 0,
      damagedMinor: 900,
      shortMinor: 900,
      differenceMinor: 0,
    });
    expect(hoAfter.positions[0]).toMatchObject({ role: 'shipper', branchCode: 'KHI02' });

    // Reconciliation per transfer and per item, both sides.
    for (const s of [ho, branch]) {
      const rec = transferReconciliation(s.env.db, s.ctx);
      expect(rec.transfers).toHaveLength(1);
      expect(rec.totals).toMatchObject({
        qtyDispatched: 130,
        qtyReceived: 120,
        qtyDamaged: 5,
        qtyShort: 5,
        qtyInTransit: 0,
        unbalanced: 0,
      });
      expect(rec.items.find((i) => i.itemId === net.para)?.cost).toMatchObject({
        dispatchedMinor: 14_400,
        receivedMinor: 12_600,
        damagedMinor: 900,
        shortMinor: 900,
        differenceMinor: 0,
      });
    }

    // Ledgers and audit chains are healthy on both databases.
    for (const s of [ho, branch]) {
      expect(verifyStockLedger(s.env.db, s.ctx).ok).toBe(true);
      expect(verifyAuditChain(s.env.db, s.branchId).ok).toBe(true);
    }
    expect(verifyStockLedger(branch.env.db, branch.ctx).negativeBatches).toEqual([]);

    // 7. Once received, it cannot be received again, cancelled or dispatched again.
    await expectDomain(() => receiveTransfer(branch.env.db, branch.ctx, note.id), 'CONFLICT');
    await expectDomain(() => cancelTransfer(ho.env.db, ho.ctx, note.id, 'mistake'), 'CONFLICT');
    await expectDomain(() => dispatchTransfer(ho.env.db, ho.ctx, note.id), 'CONFLICT');
    expect(onHand(branch, net.para)).toBe(70);
  });

  it('a second receipt of the same transfer after everything synced changes nothing', async () => {
    const { ho, branch } = net;
    const note = createTransfer(ho.env.db, ho.ctx, {
      toBranchId: branch.branchId,
      lines: [{ itemId: net.amox, batchId: stockOf(ho, net.amox)[0]!.id, qtyBase: 40 }],
    });
    dispatchTransfer(ho.env.db, ho.ctx, note.id);
    await ho.sync();
    await branch.sync();
    receiveTransfer(branch.env.db, branch.ctx, note.id);
    const movements = branch.env.db.select({ n: count() }).from(stockMovements).get()?.n;
    await expectDomain(() => receiveTransfer(branch.env.db, branch.ctx, note.id), 'CONFLICT');
    expect(branch.env.db.select({ n: count() }).from(stockMovements).get()?.n).toBe(movements);
    // Head Office cannot receive its own shipment either.
    await expectDomain(() => receiveTransfer(ho.env.db, ho.ctx, note.id), 'INVALID');
  });

  it('receiving into a branch that already holds the same batch adds to it instead of duplicating', async () => {
    const { ho, branch } = net;
    const batchId = stockOf(ho, net.amox)[0]!.id;
    const send = async (qty: number) => {
      const n = createTransfer(ho.env.db, ho.ctx, {
        toBranchId: branch.branchId,
        lines: [{ itemId: net.amox, batchId, qtyBase: qty }],
      });
      dispatchTransfer(ho.env.db, ho.ctx, n.id);
      await ho.sync();
      await branch.sync();
      receiveTransfer(branch.env.db, branch.ctx, n.id);
    };
    await send(10);
    await send(15);
    const rows = stockOf(branch, net.amox);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.available).toBe(25);
    expect(
      branch.env.db.select({ n: count() }).from(batches).where(eq(batches.itemId, net.amox)).get()
        ?.n,
    ).toBe(1);
  });
});

describe('rules on picking, dispatching and editing', () => {
  it('suggests batches first-expiry-first and reports what cannot be covered', () => {
    const s = suggestTransferBatches(net.ho.env.db, net.ho.ctx, net.para, 150);
    expect(s.picks.map((p) => [p.batchNo, p.qtyBase])).toEqual([
      ['P0', 100],
      ['P1', 50],
    ]);
    expect(s.shortfallBase).toBe(0);
    const big = suggestTransferBatches(net.ho.env.db, net.ho.ctx, net.para, 1000);
    expect(big.picks.reduce((t, p) => t + p.qtyBase, 0)).toBe(300);
    expect(big.shortfallBase).toBe(700);
  });

  it('never offers or ships expired, blocked or missing stock', async () => {
    const { ho, branch } = net;
    const p0 = stockOf(ho, net.para).find((b) => b.batchNo === 'P0')!;
    const p1 = stockOf(ho, net.para).find((b) => b.batchNo === 'P1')!;

    // More than on hand is refused at once.
    await expectDomain(
      () =>
        createTransfer(ho.env.db, ho.ctx, {
          toBranchId: branch.branchId,
          lines: [{ itemId: net.para, batchId: p0.id, qtyBase: 101 }],
        }),
      'INSUFFICIENT_STOCK',
    );

    // A blocked batch is refused and not suggested.
    ho.env.db.update(batches).set({ isBlocked: true }).where(eq(batches.id, p1.id)).run();
    await expectDomain(
      () =>
        createTransfer(ho.env.db, ho.ctx, {
          toBranchId: branch.branchId,
          lines: [{ itemId: net.para, batchId: p1.id, qtyBase: 10 }],
        }),
      'INVALID',
    );
    expect(
      suggestTransferBatches(ho.env.db, ho.ctx, net.para, 150).picks.map((p) => p.batchNo),
    ).toEqual(['P0']);
    ho.env.db.update(batches).set({ isBlocked: false }).where(eq(batches.id, p1.id)).run();

    // A note written while the batch was fine is re-checked at dispatch: it expired meanwhile.
    const note = createTransfer(ho.env.db, ho.ctx, {
      toBranchId: branch.branchId,
      lines: [{ itemId: net.para, batchId: p0.id, qtyBase: 10 }],
    });
    net.advance(90 * 24 * 3600_000); // 2027-01-03: P0 (2026-12-31) is expired, P1 (2027-01-31) is not
    await expectDomain(() => dispatchTransfer(ho.env.db, ho.ctx, note.id), 'EXPIRED_BATCH');
    await expectDomain(
      () =>
        createTransfer(ho.env.db, ho.ctx, {
          toBranchId: branch.branchId,
          lines: [{ itemId: net.para, batchId: p0.id, qtyBase: 10 }],
        }),
      'EXPIRED_BATCH',
    );
    expect(
      suggestTransferBatches(ho.env.db, ho.ctx, net.para, 50).picks.map((p) => p.batchNo),
    ).toEqual(['P1']);
    expect(onHand(ho, net.para)).toBe(300); // the failed dispatch left nothing behind
  });

  it('refuses a dispatch when the stock is gone by then (two drafts on one batch)', async () => {
    const { ho, branch } = net;
    const m1 = stockOf(ho, net.amox)[0]!;
    const make = () =>
      createTransfer(ho.env.db, ho.ctx, {
        toBranchId: branch.branchId,
        lines: [{ itemId: net.amox, batchId: m1.id, qtyBase: 200 }],
      });
    const first = make();
    const second = make();
    dispatchTransfer(ho.env.db, ho.ctx, first.id);
    await expectDomain(() => dispatchTransfer(ho.env.db, ho.ctx, second.id), 'INSUFFICIENT_STOCK');
    expect(onHand(ho, net.amox)).toBe(100);
  });

  it('cancels a draft but never a dispatched note, and only the sender acts on the sending side', async () => {
    const { ho, branch } = net;
    const p0 = stockOf(ho, net.para).find((b) => b.batchNo === 'P0')!;
    const mk = () =>
      createTransfer(ho.env.db, ho.ctx, {
        toBranchId: branch.branchId,
        lines: [{ itemId: net.para, batchId: p0.id, qtyBase: 10 }],
      });
    const a = mk();
    cancelTransfer(ho.env.db, ho.ctx, a.id, 'Wrong branch');
    await expectDomain(() => dispatchTransfer(ho.env.db, ho.ctx, a.id), 'CONFLICT');
    const b = mk();
    dispatchTransfer(ho.env.db, ho.ctx, b.id);
    await expectDomain(
      () => cancelTransfer(ho.env.db, ho.ctx, b.id, 'Changed my mind'),
      'CONFLICT',
    );
    // A branch cannot write notes, and cannot reach a draft it was never sent.
    await expectDomain(
      () =>
        createTransfer(branch.env.db, branch.ctx, {
          toBranchId: ho.branchId,
          lines: [{ itemId: net.para, batchId: p0.id, qtyBase: 1 }],
        }),
      'INVALID',
    );
    const c = mk();
    await ho.sync();
    await branch.sync();
    await expectDomain(() => getTransfer(branch.env.db, branch.ctx, c.id), 'NOT_FOUND');
    expect(listTransfers(branch.env.db, branch.ctx).rows.map((r) => r.id)).toEqual([b.id]);
  });

  it('validates requisitions: Head Office cannot ask itself, approval cannot exceed the request, cancel before approval only', async () => {
    const { ho, branch } = net;
    await expectDomain(
      () => createRequisition(ho.env.db, ho.ctx, { lines: [{ itemId: net.para, qtyBase: 5 }] }),
      'INVALID',
    );
    await expectDomain(
      () => createRequisition(branch.env.db, branch.ctx, { lines: [] }),
      'INVALID',
    );
    await expectDomain(
      () =>
        createRequisition(branch.env.db, branch.ctx, {
          lines: [
            { itemId: net.para, qtyBase: 5 },
            { itemId: net.para, qtyBase: 6 },
          ],
        }),
      'INVALID',
    );
    const r = createRequisition(branch.env.db, branch.ctx, {
      lines: [{ itemId: net.para, qtyBase: 5 }],
    });
    await branch.sync();
    await ho.sync();
    const line = getRequisition(ho.env.db, ho.ctx, r.id).lines[0]!;
    await expectDomain(
      () =>
        approveRequisition(ho.env.db, ho.ctx, r.id, {
          lines: [{ lineId: line.id, qtyApprovedBase: 6 }],
        }),
      'INVALID',
    );
    await expectDomain(
      () =>
        approveRequisition(ho.env.db, ho.ctx, r.id, {
          lines: [{ lineId: line.id, qtyApprovedBase: 0 }],
        }),
      'INVALID',
    );
    // A branch cannot approve its own request.
    await expectDomain(() => approveRequisition(branch.env.db, branch.ctx, r.id), 'INVALID');
    approveRequisition(ho.env.db, ho.ctx, r.id);
    await expectDomain(() => approveRequisition(ho.env.db, ho.ctx, r.id), 'CONFLICT');
    const r2 = createRequisition(branch.env.db, branch.ctx, {
      lines: [{ itemId: net.amox, qtyBase: 5 }],
    });
    const { cancelRequisition } = await import('./requisitions');
    cancelRequisition(branch.env.db, branch.ctx, r2.id, 'Not needed');
    await expectDomain(
      () => cancelRequisition(branch.env.db, branch.ctx, r2.id, 'again'),
      'CONFLICT',
    );
    await expectDomain(() => cancelRequisition(ho.env.db, ho.ctx, r.id, 'too late'), 'CONFLICT');
  });

  it('posted documents are protected by database triggers', async () => {
    const { ho, branch } = net;
    const m1 = stockOf(ho, net.amox)[0]!;
    const note = createTransfer(ho.env.db, ho.ctx, {
      toBranchId: branch.branchId,
      lines: [{ itemId: net.amox, batchId: m1.id, qtyBase: 10 }],
    });
    dispatchTransfer(ho.env.db, ho.ctx, note.id);
    const run = (s: string) => () => runSql(ho, s);
    expect(run(`DELETE FROM stock_transfers WHERE id = '${note.id}'`)).toThrow(/never deleted/);
    expect(run(`UPDATE stock_transfers SET status = 'draft' WHERE id = '${note.id}'`)).toThrow(
      /cannot be edited/,
    );
    expect(run(`UPDATE stock_transfers SET note = 'x' WHERE id = '${note.id}'`)).toThrow(
      /cannot be edited/,
    );
    expect(
      run(`UPDATE stock_transfers SET status = 'cancelled' WHERE id = '${note.id}'`),
    ).toThrow();
    expect(
      run(`UPDATE stock_transfer_lines SET qty_dispatched = 1 WHERE transfer_id = '${note.id}'`),
    ).toThrow(/receipt/);
    expect(
      run(`UPDATE stock_transfer_lines SET cost_unit_micro = 1 WHERE transfer_id = '${note.id}'`),
    ).toThrow(/receipt/);
    expect(run(`DELETE FROM stock_transfer_lines WHERE transfer_id = '${note.id}'`)).toThrow(
      /never deleted/,
    );
    // A receipt that does not add up is refused by the database itself.
    expect(
      run(`UPDATE stock_transfer_lines SET qty_received = 3 WHERE transfer_id = '${note.id}'`),
    ).toThrow(/receipt/);

    await ho.sync();
    await branch.sync();
    receiveTransfer(branch.env.db, branch.ctx, note.id);
    const runB = (s: string) => () => runSql(branch, s);
    expect(
      runB(`UPDATE stock_transfers SET status = 'dispatched' WHERE id = '${note.id}'`),
    ).toThrow(/cannot be edited/);
    expect(
      runB(
        `UPDATE stock_transfer_lines SET qty_received = 0, qty_short = 10 WHERE transfer_id = '${note.id}'`,
      ),
    ).toThrow(/receipt/);
    expect(
      branch.env.db.select().from(stockTransfers).where(eq(stockTransfers.id, note.id)).get()
        ?.status,
    ).toBe('received');

    const req = createRequisition(branch.env.db, branch.ctx, {
      lines: [{ itemId: net.para, qtyBase: 5 }],
    });
    expect(() => runSql(branch, `DELETE FROM stock_requisitions WHERE id = '${req.id}'`)).toThrow(
      /never deleted/,
    );
    expect(() =>
      runSql(
        branch,
        `UPDATE stock_requisition_lines SET qty_requested_base = 99 WHERE requisition_id = '${req.id}'`,
      ),
    ).toThrow(/approved/);
    expect(() =>
      runSql(branch, `UPDATE stock_requisitions SET status = 'fulfilled' WHERE id = '${req.id}'`),
    ).toThrow(/forward/);
  });
});

describe('cost is hidden from roles without the cost right', () => {
  it('strips cost fields from documents and reports, keeps quantities', async () => {
    const { ho, branch } = net;
    const note = createTransfer(ho.env.db, ho.ctx, {
      toBranchId: branch.branchId,
      lines: [{ itemId: net.amox, batchId: stockOf(ho, net.amox)[0]!.id, qtyBase: 10 }],
    });
    dispatchTransfer(ho.env.db, ho.ctx, note.id);
    const body = {
      detail: getTransfer(ho.env.db, ho.ctx, note.id),
      list: listTransfers(ho.env.db, ho.ctx),
      position: interBranchPosition(ho.env.db, ho.ctx),
      reconciliation: transferReconciliation(ho.env.db, ho.ctx),
      ledger: verifyStockLedger(ho.env.db, ho.ctx),
    };
    const clerk: AccessContext = {
      userId: 'u',
      permissions: new Set(['inventory.transfer.view']) as AccessContext['permissions'],
      allBranches: false,
      branchIds: [ho.branchId],
    };
    const full = JSON.stringify(body);
    expect(full).toContain('"cost"');
    expect(full).toContain('costUnitMicro');
    const hidden = JSON.stringify(stripFields(body, hiddenFields(clerk)));
    expect(hidden).not.toMatch(/cost|Minor|Micro/i);
    expect(hidden).toContain('qtyDispatched');
    expect(hidden).toContain('"docNo"');
  });
});

describe('audit and outbox', () => {
  it('every step writes an audit entry and an outbox row for the document', async () => {
    const { ho, branch } = net;
    const before = outboxCount(ho);
    const note = createTransfer(ho.env.db, ho.ctx, {
      toBranchId: branch.branchId,
      lines: [{ itemId: net.amox, batchId: stockOf(ho, net.amox)[0]!.id, qtyBase: 10 }],
    });
    dispatchTransfer(ho.env.db, ho.ctx, note.id);
    const events = ho.env.db
      .select({ t: syncOutbox.entityType, op: syncOutbox.op, p: syncOutbox.payloadJson })
      .from(syncOutbox)
      .all()
      .slice(before);
    expect(events.map((e) => `${e.t}:${e.op}`)).toEqual([
      'stock_transfers:insert',
      'stock_transfers:update',
    ]);
    const dispatched = JSON.parse(events[1]!.p);
    expect(dispatched.status).toBe('dispatched');
    expect(dispatched.lines).toHaveLength(1);
    expect(dispatched.movements).toHaveLength(1);
    expect(dispatched.toBranchId).toBe(branch.branchId);
    const actions = ho.env.db
      .all<{ action: string }>(sql`SELECT action FROM audit_log ORDER BY seq DESC LIMIT 2`)
      .map((r) => r.action);
    expect(actions).toEqual(['transfer.dispatch', 'transfer.create']);
  });
});
