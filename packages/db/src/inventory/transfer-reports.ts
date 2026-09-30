import { and, eq, inArray, or, sql } from 'drizzle-orm';
import {
  allocateLargestRemainder,
  lineAmountMinor,
  OUTBOUND_KINDS,
  INBOUND_KINDS,
} from '@mediescare/core';
import type { DbOrTx } from '../client';
import { isoNow, type WriteContext } from '../context';
import { stockValueMinor } from '../pharmacy/stock';
import { stockTransferLines, stockTransfers } from '../schema/sqlite-all';
import { branchMap, itemInfoMap } from './common';

// ------------------------------------------------------------ inter-branch position

/** Money at batch cost, under the key `cost` so roles without the cost right never receive it. */
export interface PositionCost {
  dispatchedMinor: number;
  receivedMinor: number;
  inTransitMinor: number;
  damagedMinor: number;
  shortMinor: number;
  /** dispatched - received - in transit - damaged - short. Zero when the books agree. */
  differenceMinor: number;
}

export interface InterBranchPosition {
  branchId: string;
  branchCode: string;
  branchName: string;
  /** What THIS branch is towards that branch: it ships to it, or it receives from it. */
  role: 'shipper' | 'receiver';
  transfers: number;
  inTransitTransfers: number;
  qtyDispatched: number;
  qtyReceived: number;
  qtyDamaged: number;
  qtyShort: number;
  qtyInTransit: number;
  cost: PositionCost;
}

const emptyCost = (): PositionCost => ({
  dispatchedMinor: 0,
  receivedMinor: 0,
  inTransitMinor: 0,
  damagedMinor: 0,
  shortMinor: 0,
  differenceMinor: 0,
});

function finish(c: PositionCost): PositionCost {
  c.differenceMinor =
    c.dispatchedMinor - c.receivedMinor - c.inTransitMinor - c.damagedMinor - c.shortMinor;
  return c;
}

/** Dispatched and received documents this branch takes part in (drafts and cancelled notes never moved goods). */
function movedTransfers(db: DbOrTx, ctx: WriteContext, extra?: ReturnType<typeof and>) {
  return db
    .select()
    .from(stockTransfers)
    .where(
      and(
        eq(stockTransfers.tenantId, ctx.tenantId),
        or(
          eq(stockTransfers.fromBranchId, ctx.branchId),
          eq(stockTransfers.toBranchId, ctx.branchId),
        ),
        inArray(stockTransfers.status, ['dispatched', 'received']),
        extra,
      ),
    );
}

/**
 * Where this branch stands with every other branch: value dispatched, received, still in transit, and
 * lost to damage or shortage, all at cost. Computed from the transfer documents on this branch's
 * database. Head Office sees a receipt only after it has synced, so its "in transit" can be higher than
 * the branch's until then.
 */
export function interBranchPosition(
  db: DbOrTx,
  ctx: WriteContext,
): {
  positions: InterBranchPosition[];
  totals: Record<'shipper' | 'receiver', { transfers: number; cost: PositionCost }>;
} {
  const docs = movedTransfers(db, ctx).all();
  const lines = docs.length
    ? db
        .select({
          id: stockTransferLines.transferId,
          d: sql<number>`sum(${stockTransferLines.qtyDispatched})`,
          r: sql<number>`sum(${stockTransferLines.qtyReceived})`,
          x: sql<number>`sum(${stockTransferLines.qtyDamaged})`,
          s: sql<number>`sum(${stockTransferLines.qtyShort})`,
        })
        .from(stockTransferLines)
        .where(
          inArray(
            stockTransferLines.transferId,
            docs.map((d) => d.id),
          ),
        )
        .groupBy(stockTransferLines.transferId)
        .all()
    : [];
  const qty = new Map(lines.map((l) => [l.id, l]));
  const names = branchMap(
    db,
    ctx.tenantId,
    docs.flatMap((d) => [d.fromBranchId, d.toBranchId]),
  );

  const rows = new Map<string, InterBranchPosition>();
  const totals = {
    shipper: { transfers: 0, cost: emptyCost() },
    receiver: { transfers: 0, cost: emptyCost() },
  };
  for (const d of docs) {
    const role = d.fromBranchId === ctx.branchId ? 'shipper' : 'receiver';
    const other = role === 'shipper' ? d.toBranchId : d.fromBranchId;
    const key = `${role}:${other}`;
    let row = rows.get(key);
    if (!row) {
      const info = names.get(other);
      row = {
        branchId: other,
        branchCode: info?.code ?? '',
        branchName: info?.name ?? '',
        role,
        transfers: 0,
        inTransitTransfers: 0,
        qtyDispatched: 0,
        qtyReceived: 0,
        qtyDamaged: 0,
        qtyShort: 0,
        qtyInTransit: 0,
        cost: emptyCost(),
      };
      rows.set(key, row);
    }
    const q = qty.get(d.id);
    const inTransit = d.status === 'dispatched';
    row.transfers += 1;
    row.qtyDispatched += Number(q?.d ?? 0);
    row.qtyReceived += Number(q?.r ?? 0);
    row.qtyDamaged += Number(q?.x ?? 0);
    row.qtyShort += Number(q?.s ?? 0);
    if (inTransit) {
      row.inTransitTransfers += 1;
      row.qtyInTransit += Number(q?.d ?? 0);
    }
    totals[role].transfers += 1;
    for (const c of [row.cost, totals[role].cost]) {
      c.dispatchedMinor += d.dispatchedCostMinor;
      c.receivedMinor += d.receivedCostMinor;
      c.damagedMinor += d.damagedCostMinor;
      c.shortMinor += d.shortCostMinor;
      if (inTransit) c.inTransitMinor += d.dispatchedCostMinor;
    }
  }
  const positions = [...rows.values()].sort(
    (a, b) => a.role.localeCompare(b.role) || a.branchName.localeCompare(b.branchName),
  );
  for (const p of positions) finish(p.cost);
  finish(totals.shipper.cost);
  finish(totals.receiver.cost);
  return { positions, totals };
}

// ------------------------------------------------------------ transfer reconciliation

export interface ReconciliationFilter {
  /** The other branch. */
  branchId?: string;
  itemId?: string;
  status?: 'dispatched' | 'received';
  /** 'YYYY-MM-DD', compared with the dispatch date. */
  from?: string;
  to?: string;
}

interface Quantities {
  qtyDispatched: number;
  qtyReceived: number;
  qtyDamaged: number;
  qtyShort: number;
  qtyInTransit: number;
}

export interface ReconciliationTransferRow extends Quantities {
  id: string;
  docNo: string;
  status: 'dispatched' | 'received';
  direction: 'outgoing' | 'incoming';
  branchName: string;
  dispatchedAt: string | null;
  receivedAt: string | null;
  /** Dispatched equals received + damaged + short + in transit. */
  balanced: boolean;
  cost: PositionCost;
}

export interface ReconciliationItemRow extends Quantities {
  itemId: string;
  sku: string;
  name: string;
  cost: PositionCost;
}

const MAX_RECONCILIATION_ROWS = 2000;

/**
 * Dispatched against received, damaged, short and still in transit, per transfer and per item, with
 * the value at cost. Every dispatched unit is in exactly one of those buckets.
 */
export function transferReconciliation(
  db: DbOrTx,
  ctx: WriteContext,
  filter: ReconciliationFilter = {},
): {
  transfers: ReconciliationTransferRow[];
  items: ReconciliationItemRow[];
  totals: Quantities & { cost: PositionCost; unbalanced: number };
  truncated: boolean;
} {
  const extra = and(
    filter.status ? eq(stockTransfers.status, filter.status) : undefined,
    filter.branchId
      ? or(
          eq(stockTransfers.fromBranchId, filter.branchId),
          eq(stockTransfers.toBranchId, filter.branchId),
        )
      : undefined,
    filter.from ? sql`substr(${stockTransfers.dispatchedAt}, 1, 10) >= ${filter.from}` : undefined,
    filter.to ? sql`substr(${stockTransfers.dispatchedAt}, 1, 10) <= ${filter.to}` : undefined,
    filter.itemId
      ? sql`${stockTransfers.id} IN (SELECT transfer_id FROM stock_transfer_lines WHERE item_id = ${filter.itemId})`
      : undefined,
  );
  const docs = movedTransfers(db, ctx, extra)
    .orderBy(sql`${stockTransfers.dispatchedAt} DESC`)
    .limit(MAX_RECONCILIATION_ROWS + 1)
    .all();
  const truncated = docs.length > MAX_RECONCILIATION_ROWS;
  if (truncated) docs.pop();
  const lines = docs.length
    ? db
        .select()
        .from(stockTransferLines)
        .where(
          and(
            inArray(
              stockTransferLines.transferId,
              docs.map((d) => d.id),
            ),
            filter.itemId ? eq(stockTransferLines.itemId, filter.itemId) : undefined,
          ),
        )
        .all()
    : [];
  const names = branchMap(
    db,
    ctx.tenantId,
    docs.flatMap((d) => [d.fromBranchId, d.toBranchId]),
  );
  const info = itemInfoMap(
    db,
    ctx.tenantId,
    lines.map((l) => l.itemId),
  );
  const status = new Map(docs.map((d) => [d.id, d.status]));

  const perItem = new Map<string, ReconciliationItemRow>();
  const perDoc = new Map<string, { q: Quantities; c: PositionCost }>();
  for (const l of lines) {
    const received = status.get(l.transferId) === 'received';
    const value = lineAmountMinor(l.qtyDispatched, l.costUnitMicro);
    const [r, x, s] = received
      ? (allocateLargestRemainder(value, [l.qtyReceived, l.qtyDamaged, l.qtyShort]) as [
          number,
          number,
          number,
        ])
      : [0, 0, 0];
    const q: Quantities = {
      qtyDispatched: l.qtyDispatched,
      qtyReceived: l.qtyReceived,
      qtyDamaged: l.qtyDamaged,
      qtyShort: l.qtyShort,
      qtyInTransit: received ? 0 : l.qtyDispatched,
    };
    const c: PositionCost = {
      dispatchedMinor: value,
      receivedMinor: r,
      damagedMinor: x,
      shortMinor: s,
      inTransitMinor: received ? 0 : value,
      differenceMinor: 0,
    };
    const add = (target: Quantities, cost: PositionCost) => {
      target.qtyDispatched += q.qtyDispatched;
      target.qtyReceived += q.qtyReceived;
      target.qtyDamaged += q.qtyDamaged;
      target.qtyShort += q.qtyShort;
      target.qtyInTransit += q.qtyInTransit;
      cost.dispatchedMinor += c.dispatchedMinor;
      cost.receivedMinor += c.receivedMinor;
      cost.damagedMinor += c.damagedMinor;
      cost.shortMinor += c.shortMinor;
      cost.inTransitMinor += c.inTransitMinor;
    };
    let item = perItem.get(l.itemId);
    if (!item) {
      const i = info.get(l.itemId);
      item = {
        itemId: l.itemId,
        sku: i?.sku ?? '',
        name: i?.name ?? 'Unknown item',
        qtyDispatched: 0,
        qtyReceived: 0,
        qtyDamaged: 0,
        qtyShort: 0,
        qtyInTransit: 0,
        cost: emptyCost(),
      };
      perItem.set(l.itemId, item);
    }
    add(item, item.cost);
    let doc = perDoc.get(l.transferId);
    if (!doc) {
      doc = {
        q: { qtyDispatched: 0, qtyReceived: 0, qtyDamaged: 0, qtyShort: 0, qtyInTransit: 0 },
        c: emptyCost(),
      };
      perDoc.set(l.transferId, doc);
    }
    add(doc.q, doc.c);
  }

  const transfers: ReconciliationTransferRow[] = docs.map((d) => {
    const agg = perDoc.get(d.id);
    const q = agg?.q ?? {
      qtyDispatched: 0,
      qtyReceived: 0,
      qtyDamaged: 0,
      qtyShort: 0,
      qtyInTransit: 0,
    };
    const other = d.fromBranchId === ctx.branchId ? d.toBranchId : d.fromBranchId;
    return {
      id: d.id,
      docNo: d.docNo,
      status: d.status as 'dispatched' | 'received',
      direction: d.fromBranchId === ctx.branchId ? 'outgoing' : 'incoming',
      branchName: names.get(other)?.name ?? '',
      dispatchedAt: d.dispatchedAt,
      receivedAt: d.receivedAt,
      ...q,
      balanced: q.qtyDispatched === q.qtyReceived + q.qtyDamaged + q.qtyShort + q.qtyInTransit,
      cost: finish(agg?.c ?? emptyCost()),
    };
  });
  const items = [...perItem.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const i of items) finish(i.cost);

  const totals = {
    qtyDispatched: 0,
    qtyReceived: 0,
    qtyDamaged: 0,
    qtyShort: 0,
    qtyInTransit: 0,
    cost: emptyCost(),
    unbalanced: transfers.filter((t) => !t.balanced || t.cost.differenceMinor !== 0).length,
  };
  for (const t of transfers) {
    totals.qtyDispatched += t.qtyDispatched;
    totals.qtyReceived += t.qtyReceived;
    totals.qtyDamaged += t.qtyDamaged;
    totals.qtyShort += t.qtyShort;
    totals.qtyInTransit += t.qtyInTransit;
    totals.cost.dispatchedMinor += t.cost.dispatchedMinor;
    totals.cost.receivedMinor += t.cost.receivedMinor;
    totals.cost.damagedMinor += t.cost.damagedMinor;
    totals.cost.shortMinor += t.cost.shortMinor;
    totals.cost.inTransitMinor += t.cost.inTransitMinor;
  }
  finish(totals.cost);
  return { transfers, items, totals, truncated };
}

// ------------------------------------------------------------ ledger integrity

export interface LedgerCheck {
  ok: boolean;
  checkedAt: string;
  batchesChecked: number;
  movementsChecked: number;
  /** On hand in the smallest unit, all items. */
  onHandBase: number;
  /** Batches whose movements add up to less than zero. */
  negativeBatches: { batchId: string; itemName: string; batchNo: string; balanceBase: number }[];
  /** Movements whose batch does not exist on this database. */
  orphanMovements: { movementId: string; batchId: string }[];
  /** Movements whose batch belongs to another branch or another item. */
  mismatchedMovements: { movementId: string; batchId: string }[];
  /** Movements whose sign contradicts their kind (a sale that adds stock, a receipt that removes it). */
  signErrors: { movementId: string; kind: string; qtyBase: number }[];
  cost: { stockValueMinor: number };
}

const LIST_LIMIT = 100;

/**
 * Recomputes every batch balance from the append-only ledger and flags what cannot be right:
 * negative batches, movements that point to a missing or foreign batch, and movements with the wrong
 * sign for their kind. Read only. Stock is never stored as a number, so this cannot "repair" anything:
 * a problem is fixed by a new adjustment or a return, never by editing history.
 */
export function verifyStockLedger(db: DbOrTx, ctx: WriteContext): LedgerCheck {
  const branch = ctx.branchId;
  const counts = db.get<{ b: number; m: number; q: number }>(sql`
    SELECT (SELECT count(*) FROM batches WHERE branch_id = ${branch}) AS b,
           (SELECT count(*) FROM stock_movements WHERE branch_id = ${branch}) AS m,
           (SELECT COALESCE(SUM(qty_base), 0) FROM stock_movements WHERE branch_id = ${branch}) AS q`);
  const negative = db.all<{ id: string; name: string; batch_no: string; bal: number }>(sql`
    SELECT b.id, i.name, b.batch_no, SUM(m.qty_base) AS bal
    FROM batches b
    JOIN items i ON i.id = b.item_id
    JOIN stock_movements m ON m.batch_id = b.id
    WHERE b.branch_id = ${branch}
    GROUP BY b.id HAVING SUM(m.qty_base) < 0
    ORDER BY bal LIMIT ${LIST_LIMIT}`);
  const orphans = db.all<{ id: string; batch_id: string }>(sql`
    SELECT m.id, m.batch_id FROM stock_movements m
    LEFT JOIN batches b ON b.id = m.batch_id
    WHERE m.branch_id = ${branch} AND b.id IS NULL LIMIT ${LIST_LIMIT}`);
  const mismatched = db.all<{ id: string; batch_id: string }>(sql`
    SELECT m.id, m.batch_id FROM stock_movements m
    JOIN batches b ON b.id = m.batch_id
    WHERE m.branch_id = ${branch} AND (b.branch_id <> m.branch_id OR b.item_id <> m.item_id)
    LIMIT ${LIST_LIMIT}`);
  const outbound = [...OUTBOUND_KINDS];
  const inbound = [...INBOUND_KINDS];
  const signs = db.all<{ id: string; kind: string; qty_base: number }>(sql`
    SELECT id, kind, qty_base FROM stock_movements
    WHERE branch_id = ${branch} AND (
      qty_base = 0
      OR (kind IN (${sql.join(
        outbound.map((k) => sql`${k}`),
        sql`, `,
      )}) AND qty_base > 0)
      OR (kind IN (${sql.join(
        inbound.map((k) => sql`${k}`),
        sql`, `,
      )}) AND qty_base < 0))
    LIMIT ${LIST_LIMIT}`);

  const result: LedgerCheck = {
    ok: false,
    checkedAt: isoNow(ctx),
    batchesChecked: Number(counts?.b ?? 0),
    movementsChecked: Number(counts?.m ?? 0),
    onHandBase: Number(counts?.q ?? 0),
    negativeBatches: negative.map((n) => ({
      batchId: n.id,
      itemName: n.name,
      batchNo: n.batch_no,
      balanceBase: Number(n.bal),
    })),
    orphanMovements: orphans.map((o) => ({ movementId: o.id, batchId: o.batch_id })),
    mismatchedMovements: mismatched.map((o) => ({ movementId: o.id, batchId: o.batch_id })),
    signErrors: signs.map((s) => ({
      movementId: s.id,
      kind: s.kind,
      qtyBase: Number(s.qty_base),
    })),
    cost: { stockValueMinor: stockValueMinor(db, branch) },
  };
  result.ok =
    result.negativeBatches.length === 0 &&
    result.orphanMovements.length === 0 &&
    result.mismatchedMovements.length === 0 &&
    result.signErrors.length === 0;
  return result;
}
