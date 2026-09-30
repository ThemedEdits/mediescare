import { sql } from 'drizzle-orm';
import { branchToday } from '../pharmacy/common';
import { EXPIRY_BUCKETS, type ExpiryBucket, type ReportRow, type ReportRunner } from './types';
import { clampLimit, cut, itemMatch, MAX_ROWS, num, resolveRange, sumRows } from './util';

const BUCKET_LABEL: Record<ExpiryBucket, string> = {
  expired: 'Expired',
  '0-30': '0-30 days',
  '31-60': '31-60 days',
  '61-90': '61-90 days',
  '91-180': '91-180 days',
};

const ITEM_ACTIVE = sql`i.deleted_at IS NULL AND i.is_active = 1`;

export const stockCurrent: ReportRunner = (db, ctx, filters) => {
  const today = branchToday(db, ctx);
  const cap = clampLimit(filters.limit, MAX_ROWS);
  const found = db.all<{
    sku: string;
    name: string;
    onhand: number;
    expired: number;
    sellable: number;
    reorder: number;
    value: number;
  }>(sql`
    SELECT i.sku, i.name,
      COALESCE(SUM(m.qty_base), 0) AS onhand,
      COALESCE(SUM(CASE WHEN b.expiry_date < ${today} THEN m.qty_base ELSE 0 END), 0) AS expired,
      COALESCE(SUM(CASE WHEN b.expiry_date >= ${today} AND b.is_blocked = 0 THEN m.qty_base ELSE 0 END), 0) AS sellable,
      i.reorder_level_base AS reorder,
      COALESCE(SUM(m.qty_base * m.unit_cost_micro), 0) / 10000 AS value
    FROM items i
    JOIN stock_movements m ON m.item_id = i.id AND m.branch_id = ${ctx.branchId}
    JOIN batches b ON b.id = m.batch_id
    WHERE i.tenant_id = ${ctx.tenantId} AND ${ITEM_ACTIVE} ${itemMatch(filters.q, 'i')}
    GROUP BY i.id
    HAVING SUM(m.qty_base) <> 0
    ORDER BY i.name
    LIMIT ${cap + 1}`);
  const { rows: page, truncated } = cut(found, cap);
  const rows: ReportRow[] = page.map((r) => ({
    sku: r.sku,
    item: r.name,
    onHand: num(r.onhand),
    sellable: num(r.sellable),
    expired: num(r.expired),
    reorder: num(r.reorder),
    costValueMinor: num(r.value),
  }));
  return {
    id: 'stock-current',
    title: 'Current stock',
    columns: [
      { key: 'sku', label: 'Code', type: 'text' },
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'onHand', label: 'On hand', type: 'qty', align: 'end' },
      { key: 'sellable', label: 'Sellable', type: 'qty', align: 'end' },
      { key: 'expired', label: 'Expired', type: 'qty', align: 'end' },
      { key: 'reorder', label: 'Reorder level', type: 'qty', align: 'end' },
      {
        key: 'costValueMinor',
        label: 'Value at cost',
        type: 'money',
        align: 'end',
        sensitivity: 'cost',
      },
    ],
    rows,
    totals: sumRows(rows, ['onHand', 'sellable', 'expired', 'costValueMinor']),
    note: 'Items with stock on hand, in the smallest unit. Sellable leaves out expired and blocked batches.',
    truncated,
  };
};

export const stockValuation: ReportRunner = (db, ctx) => {
  const found = db.all<{
    category: string;
    items: number;
    qty: number;
    cost: number;
    retail: number;
  }>(sql`
    SELECT COALESCE(c.name, 'No category') AS category, COUNT(*) AS items, SUM(s.qty) AS qty,
      SUM(s.value) / 10000 AS cost, SUM(s.qty * i.retail_rate_unit_micro) / 10000 AS retail
    FROM (
      SELECT item_id, SUM(qty_base) AS qty, SUM(qty_base * unit_cost_micro) AS value
      FROM stock_movements WHERE branch_id = ${ctx.branchId}
      GROUP BY item_id HAVING SUM(qty_base) <> 0
    ) s
    JOIN items i ON i.id = s.item_id
    LEFT JOIN categories c ON c.id = i.category_id
    GROUP BY c.id
    ORDER BY cost DESC`);
  const rows: ReportRow[] = found.map((r) => ({
    category: r.category,
    items: num(r.items),
    qty: num(r.qty),
    costValueMinor: num(r.cost),
    retailValueMinor: num(r.retail),
  }));
  const totals = sumRows(rows, ['items', 'qty', 'costValueMinor', 'retailValueMinor']);
  return {
    id: 'stock-valuation',
    title: 'Stock valuation by category',
    columns: [
      { key: 'category', label: 'Category', type: 'text' },
      { key: 'items', label: 'Items', type: 'qty', align: 'end' },
      { key: 'qty', label: 'Quantity', type: 'qty', align: 'end' },
      {
        key: 'costValueMinor',
        label: 'Value at cost',
        type: 'money',
        align: 'end',
        sensitivity: 'cost',
      },
      { key: 'retailValueMinor', label: 'Value at retail', type: 'money', align: 'end' },
    ],
    rows,
    totals,
    kpis: [
      { label: 'Items in stock', value: num(totals.items), type: 'qty' },
      {
        label: 'Value at cost',
        value: num(totals.costValueMinor),
        type: 'money',
        sensitivity: 'cost',
      },
      { label: 'Value at retail', value: num(totals.retailValueMinor), type: 'money' },
    ],
    note: 'Retail value uses each item price per smallest unit. Quantities include expired batches still on the shelf.',
  };
};

export const expiry: ReportRunner = (db, ctx, filters) => {
  const today = branchToday(db, ctx);
  const cap = clampLimit(filters.limit, 10_000);
  const wanted = (EXPIRY_BUCKETS as readonly string[]).includes(filters.bucket ?? '')
    ? (filters.bucket as ExpiryBucket)
    : null;
  const bucketSql = sql`CASE
      WHEN t.days < 0 THEN 'expired' WHEN t.days <= 30 THEN '0-30' WHEN t.days <= 60 THEN '31-60'
      WHEN t.days <= 90 THEN '61-90' ELSE '91-180' END`;
  const found = db.all<{
    batch_no: string;
    sku: string;
    name: string;
    qty: number;
    expiry_date: string;
    days: number;
    bucket: ExpiryBucket;
    cost: number;
  }>(sql`
    SELECT t.*, ${bucketSql} AS bucket FROM (
      SELECT b.batch_no, i.sku, i.name, b.expiry_date, SUM(m.qty_base) AS qty,
        CAST(julianday(b.expiry_date) - julianday(${today}) AS INTEGER) AS days,
        SUM(m.qty_base) * b.cost_unit_micro / 10000 AS cost
      FROM batches b
      JOIN items i ON i.id = b.item_id
      JOIN stock_movements m ON m.batch_id = b.id
      WHERE b.branch_id = ${ctx.branchId} AND b.expiry_date <= date(${today}, '+180 days')
        ${itemMatch(filters.q, 'i')}
      GROUP BY b.id
      HAVING SUM(m.qty_base) > 0
    ) t
    WHERE ${wanted ? sql`${bucketSql} = ${wanted}` : sql`1 = 1`}
    ORDER BY t.expiry_date, t.name
    LIMIT ${cap + 1}`);
  const { rows: page, truncated } = cut(found, cap);
  const rows: ReportRow[] = page.map((r) => ({
    batchNo: r.batch_no,
    item: r.name,
    qty: num(r.qty),
    expiryDate: r.expiry_date,
    daysLeft: num(r.days),
    bucket: BUCKET_LABEL[r.bucket],
    costValueMinor: num(r.cost),
  }));
  const expiredRows = page.filter((r) => r.bucket === 'expired');
  const soon = page.filter((r) => r.bucket === '0-30');
  return {
    id: 'expiry',
    title: 'Expiry',
    columns: [
      { key: 'batchNo', label: 'Batch', type: 'text' },
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'qty', label: 'Quantity', type: 'qty', align: 'end' },
      { key: 'expiryDate', label: 'Expiry', type: 'date' },
      { key: 'daysLeft', label: 'Days left', type: 'qty', align: 'end' },
      { key: 'bucket', label: 'Bucket', type: 'text' },
      {
        key: 'costValueMinor',
        label: 'Value at cost',
        type: 'money',
        align: 'end',
        sensitivity: 'cost',
      },
    ],
    rows,
    totals: sumRows(rows, ['qty', 'costValueMinor']),
    kpis: [
      { label: 'Expired batches', value: expiredRows.length, type: 'qty' },
      { label: 'Expiring in 30 days', value: soon.length, type: 'qty' },
      {
        label: 'Expired value at cost',
        value: expiredRows.reduce((s, r) => s + num(r.cost), 0),
        type: 'money',
        sensitivity: 'cost',
      },
    ],
    note: 'Batches with stock that are expired or expire within 180 days. A batch can be sold through its expiry date.',
    truncated,
  };
};

export const lowStock: ReportRunner = (db, ctx, filters) => {
  const today = branchToday(db, ctx);
  const range = resolveRange(db, ctx, filters, 30);
  const cap = clampLimit(filters.limit, 10_000);
  const found = db.all<{
    sku: string;
    name: string;
    sellable: number;
    reorder: number;
    missed: number;
  }>(sql`
    SELECT i.sku, i.name, COALESCE(st.sellable, 0) AS sellable, i.reorder_level_base AS reorder,
      COALESCE(ms.missed, 0) AS missed
    FROM items i
    LEFT JOIN (
      SELECT m.item_id,
        SUM(CASE WHEN b.expiry_date >= ${today} AND b.is_blocked = 0 THEN m.qty_base ELSE 0 END) AS sellable
      FROM stock_movements m JOIN batches b ON b.id = m.batch_id
      WHERE m.branch_id = ${ctx.branchId}
      GROUP BY m.item_id
    ) st ON st.item_id = i.id
    LEFT JOIN (
      SELECT item_id, COUNT(*) AS missed FROM missed_sales
      WHERE branch_id = ${ctx.branchId} AND item_id IS NOT NULL
        AND created_at >= ${range.startIso} AND created_at < ${range.endIso}
      GROUP BY item_id
    ) ms ON ms.item_id = i.id
    WHERE i.tenant_id = ${ctx.tenantId} AND ${ITEM_ACTIVE} ${itemMatch(filters.q, 'i')}
      AND ((i.reorder_level_base > 0 AND COALESCE(st.sellable, 0) <= i.reorder_level_base)
        OR (COALESCE(ms.missed, 0) > 0 AND COALESCE(st.sellable, 0) <= 0))
    ORDER BY (i.reorder_level_base - COALESCE(st.sellable, 0)) DESC, i.name
    LIMIT ${cap + 1}`);
  const { rows: page, truncated } = cut(found, cap);
  const rows: ReportRow[] = page.map((r) => ({
    sku: r.sku,
    item: r.name,
    sellable: num(r.sellable),
    reorder: num(r.reorder),
    shortfall: Math.max(num(r.reorder) - num(r.sellable), 0),
    missed: num(r.missed),
  }));
  return {
    id: 'low-stock',
    title: 'Low stock',
    columns: [
      { key: 'sku', label: 'Code', type: 'text' },
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'sellable', label: 'Sellable', type: 'qty', align: 'end' },
      { key: 'reorder', label: 'Reorder level', type: 'qty', align: 'end' },
      { key: 'shortfall', label: 'Shortfall', type: 'qty', align: 'end' },
      { key: 'missed', label: 'Missed sales', type: 'qty', align: 'end' },
    ],
    rows,
    totals: sumRows(rows, ['shortfall', 'missed']),
    note: `Items at or below their reorder level, and items out of stock that customers asked for. Missed sales are counted from ${range.from} to ${range.to} (last 30 days if no dates are given).`,
    truncated,
  };
};
