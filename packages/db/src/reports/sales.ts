import { proportionMinor } from '@mediescare/core';
import { sql } from 'drizzle-orm';
import { dailyFigures } from './daily';
import type { ReportColumn, ReportResult, ReportRow, ReportRunner } from './types';
import { clampLimit, cut, likePattern, num, percent, resolveRange, sumRows } from './util';

const money = (key: string, label: string, sensitivity?: ReportColumn['sensitivity']) =>
  ({ key, label, type: 'money', align: 'end', sensitivity }) satisfies ReportColumn;
const qty = (key: string, label: string) =>
  ({ key, label, type: 'qty', align: 'end' }) satisfies ReportColumn;

export const salesDaily: ReportRunner = (db, ctx, filters) => {
  const range = resolveRange(db, ctx, filters, 7);
  const rows: ReportRow[] = dailyFigures(db, ctx, range).map((d) => ({ ...d }));
  const totals = sumRows(rows, [
    'invoices',
    'gross',
    'discount',
    'tax',
    'billed',
    'returns',
    'netRevenue',
    'voids',
    'cost',
    'profit',
  ]);
  return {
    id: 'sales-daily',
    title: 'Sales by day',
    columns: [
      { key: 'date', label: 'Date', type: 'date' },
      qty('invoices', 'Invoices'),
      money('gross', 'Gross'),
      money('discount', 'Discount'),
      money('tax', 'Tax'),
      money('billed', 'Billed total'),
      money('returns', 'Returns'),
      money('netRevenue', 'Net revenue'),
      qty('voids', 'Voids'),
      money('cost', 'Cost of goods', 'cost'),
      money('profit', 'Profit', 'profit'),
    ],
    rows,
    totals,
    kpis: [
      { label: 'Invoices', value: num(totals.invoices), type: 'qty' },
      { label: 'Net revenue', value: num(totals.netRevenue), type: 'money' },
      { label: 'Returns', value: num(totals.returns), type: 'money' },
      { label: 'Profit', value: num(totals.profit), type: 'money', sensitivity: 'profit' },
    ],
    note: 'Voided invoices are not counted as sales. Returns are taken off on the day they were made. Net revenue is without tax.',
  };
};

export const salesInvoices: ReportRunner = (db, ctx, filters) => {
  const range = resolveRange(db, ctx, filters);
  const cap = clampLimit(filters.limit, 5_000);
  const like = likePattern(filters.q);
  const where = sql`s.branch_id = ${ctx.branchId} AND s.created_at >= ${range.startIso} AND s.created_at < ${range.endIso}
    ${like ? sql`AND (lower(s.doc_no) LIKE ${like} ESCAPE '\\' OR lower(COALESCE(c.name, '')) LIKE ${like} ESCAPE '\\')` : sql``}`;
  const found = db.all<{
    doc_no: string;
    at: string;
    cashier: string | null;
    customer: string | null;
    modes: string | null;
    total: number;
    disc: number;
    status: string;
    cost: number;
    profit: number;
  }>(sql`
    SELECT s.doc_no, strftime('%Y-%m-%d %H:%M', s.created_at, ${range.localMod}) AS at,
      u.full_name AS cashier, c.name AS customer,
      (SELECT group_concat(pm.name, ', ') FROM sale_payments p JOIN payment_modes pm ON pm.id = p.mode_id
        WHERE p.sale_id = s.id) AS modes,
      s.grand_total_minor AS total, s.discount_minor AS disc, s.status,
      s.cost_minor AS cost,
      CASE WHEN s.status = 'posted' THEN s.grand_total_minor - s.tax_minor - s.cost_minor ELSE 0 END AS profit
    FROM sales s
    LEFT JOIN users u ON u.id = s.created_by
    LEFT JOIN customers c ON c.id = s.customer_id
    WHERE ${where}
    ORDER BY s.created_at DESC
    LIMIT ${cap + 1}`);
  const { rows: page, truncated } = cut(found, cap);
  const sum = db.get<{ n: number; total: number; disc: number; cost: number; profit: number }>(sql`
    SELECT COUNT(*) AS n, COALESCE(SUM(s.grand_total_minor), 0) AS total, COALESCE(SUM(s.discount_minor), 0) AS disc,
      COALESCE(SUM(s.cost_minor), 0) AS cost,
      COALESCE(SUM(s.grand_total_minor - s.tax_minor - s.cost_minor), 0) AS profit
    FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
    WHERE s.status = 'posted' AND ${where}`);
  const result: ReportResult = {
    id: 'sales-invoices',
    title: 'Invoices',
    columns: [
      { key: 'docNo', label: 'Invoice', type: 'text' },
      { key: 'time', label: 'Time', type: 'datetime' },
      { key: 'cashier', label: 'Cashier', type: 'text' },
      { key: 'customer', label: 'Customer', type: 'text' },
      { key: 'modes', label: 'Payment', type: 'text' },
      money('total', 'Total'),
      money('discount', 'Discount'),
      { key: 'status', label: 'Status', type: 'text' },
      money('cost', 'Cost', 'cost'),
      money('profit', 'Profit', 'profit'),
    ],
    rows: page.map((r) => ({
      docNo: r.doc_no,
      time: r.at,
      cashier: r.cashier,
      customer: r.customer ?? 'Walk-in',
      modes: r.modes,
      total: num(r.total),
      discount: num(r.disc),
      status: r.status === 'void' ? 'Void' : 'Posted',
      cost: num(r.cost),
      profit: num(r.profit),
    })),
    totals: {
      total: num(sum?.total),
      discount: num(sum?.disc),
      cost: num(sum?.cost),
      profit: num(sum?.profit),
    },
    kpis: [
      { label: 'Posted invoices', value: num(sum?.n), type: 'qty' },
      { label: 'Billed total', value: num(sum?.total), type: 'money' },
    ],
    note: 'Totals count posted invoices only. Void invoices are listed but not added up.',
    truncated,
  };
  return result;
};

export const salesByItem: ReportRunner = (db, ctx, filters) => {
  const range = resolveRange(db, ctx, filters);
  const cap = clampLimit(filters.limit, 100);
  const like = likePattern(filters.q);
  const itemFilter = like
    ? sql`AND (lower(i.name) LIKE ${like} ESCAPE '\\' OR lower(COALESCE(i.generic_name, '')) LIKE ${like} ESCAPE '\\' OR lower(i.sku) LIKE ${like} ESCAPE '\\')`
    : sql``;
  const found = db.all<{
    id: string;
    sku: string;
    name: string;
    qty: number;
    revenue: number;
    cost: number;
  }>(sql`
    SELECT i.id, i.sku, i.name, SUM(sl.qty_base) AS qty,
      SUM(sl.net_minor - sl.tax_minor) AS revenue, SUM(sl.cost_minor) AS cost
    FROM sales s
    JOIN sale_lines sl ON sl.sale_id = s.id
    JOIN items i ON i.id = sl.item_id
    WHERE s.branch_id = ${ctx.branchId} AND s.status = 'posted'
      AND s.created_at >= ${range.startIso} AND s.created_at < ${range.endIso} ${itemFilter}
    GROUP BY i.id
    ORDER BY revenue DESC, i.name
    LIMIT ${cap + 1}`);
  const { rows: page, truncated } = cut(found, cap);
  const sum = db.get<{ qty: number; revenue: number; cost: number }>(sql`
    SELECT COALESCE(SUM(sl.qty_base), 0) AS qty, COALESCE(SUM(sl.net_minor - sl.tax_minor), 0) AS revenue,
      COALESCE(SUM(sl.cost_minor), 0) AS cost
    FROM sales s
    JOIN sale_lines sl ON sl.sale_id = s.id
    JOIN items i ON i.id = sl.item_id
    WHERE s.branch_id = ${ctx.branchId} AND s.status = 'posted'
      AND s.created_at >= ${range.startIso} AND s.created_at < ${range.endIso} ${itemFilter}`);
  const back = new Map(
    db
      .all<{ id: string; qty: number; refund: number }>(
        sql`
    SELECT rl.item_id AS id, SUM(rl.qty_base) AS qty, SUM(rl.refund_minor) AS refund
    FROM sale_returns r JOIN sale_return_lines rl ON rl.return_id = r.id
    WHERE r.branch_id = ${ctx.branchId} AND r.created_at >= ${range.startIso} AND r.created_at < ${range.endIso}
    GROUP BY rl.item_id`,
      )
      .map((r) => [r.id, r] as const),
  );
  const rows: ReportRow[] = page.map((r) => {
    const revenue = num(r.revenue);
    const cost = num(r.cost);
    const profit = revenue - cost;
    return {
      sku: r.sku,
      item: r.name,
      qty: num(r.qty),
      returnedQty: num(back.get(r.id)?.qty),
      returns: num(back.get(r.id)?.refund),
      revenue,
      cost,
      profit,
      marginPct: percent(profit, revenue),
    };
  });
  const revenue = num(sum?.revenue);
  const cost = num(sum?.cost);
  return {
    id: 'sales-by-item',
    title: 'Sales by item',
    columns: [
      { key: 'sku', label: 'Code', type: 'text' },
      { key: 'item', label: 'Item', type: 'text' },
      qty('qty', 'Qty sold'),
      qty('returnedQty', 'Qty returned'),
      money('returns', 'Returns'),
      money('revenue', 'Revenue'),
      money('cost', 'Cost', 'cost'),
      money('profit', 'Profit', 'profit'),
      { key: 'marginPct', label: 'Margin %', type: 'percent', align: 'end', sensitivity: 'profit' },
    ],
    rows,
    totals: {
      qty: num(sum?.qty),
      revenue,
      cost,
      profit: revenue - cost,
      marginPct: percent(revenue - cost, revenue),
    },
    note: 'Quantities are in the smallest unit. Revenue is without tax and before returns; returns are shown beside it. Totals cover all items, not only the rows shown.',
    truncated,
  };
};

export const salesByCashier: ReportRunner = (db, ctx, filters) => {
  const range = resolveRange(db, ctx, filters);
  const found = db.all<{
    name: string | null;
    inv: number;
    billed: number;
    disc: number;
    voids: number;
    cost: number;
    profit: number;
  }>(sql`
    SELECT u.full_name AS name, SUM(s.status = 'posted') AS inv,
      SUM(CASE WHEN s.status = 'posted' THEN s.grand_total_minor ELSE 0 END) AS billed,
      SUM(CASE WHEN s.status = 'posted' THEN s.discount_minor ELSE 0 END) AS disc,
      SUM(s.status = 'void') AS voids,
      SUM(CASE WHEN s.status = 'posted' THEN s.cost_minor ELSE 0 END) AS cost,
      SUM(CASE WHEN s.status = 'posted' THEN s.grand_total_minor - s.tax_minor - s.cost_minor ELSE 0 END) AS profit
    FROM sales s LEFT JOIN users u ON u.id = s.created_by
    WHERE s.branch_id = ${ctx.branchId} AND s.created_at >= ${range.startIso} AND s.created_at < ${range.endIso}
    GROUP BY s.created_by
    ORDER BY billed DESC`);
  const rows: ReportRow[] = found.map((r) => ({
    cashier: r.name ?? 'Unknown',
    invoices: num(r.inv),
    billed: num(r.billed),
    average: num(r.inv) === 0 ? 0 : proportionMinor(num(r.billed), 1, num(r.inv)),
    discount: num(r.disc),
    voids: num(r.voids),
    cost: num(r.cost),
    profit: num(r.profit),
  }));
  const totals = sumRows(rows, ['invoices', 'billed', 'discount', 'voids', 'cost', 'profit']);
  totals.average =
    num(totals.invoices) === 0 ? 0 : proportionMinor(num(totals.billed), 1, num(totals.invoices));
  return {
    id: 'sales-by-cashier',
    title: 'Sales by cashier',
    columns: [
      { key: 'cashier', label: 'Cashier', type: 'text' },
      qty('invoices', 'Invoices'),
      money('billed', 'Billed total'),
      money('average', 'Average bill'),
      money('discount', 'Discount'),
      qty('voids', 'Voids'),
      money('cost', 'Cost', 'cost'),
      money('profit', 'Profit', 'profit'),
    ],
    rows,
    totals,
  };
};

export const salesByPaymentMode: ReportRunner = (db, ctx, filters) => {
  const range = resolveRange(db, ctx, filters);
  const taken = db.all<{ id: string; name: string; kind: string; n: number; amount: number }>(sql`
    SELECT pm.id, pm.name, pm.kind, COUNT(*) AS n, SUM(p.amount_minor) AS amount
    FROM sales s
    JOIN sale_payments p ON p.sale_id = s.id
    JOIN payment_modes pm ON pm.id = p.mode_id
    WHERE s.branch_id = ${ctx.branchId} AND s.status = 'posted'
      AND s.created_at >= ${range.startIso} AND s.created_at < ${range.endIso}
    GROUP BY pm.id`);
  const refunded = db.all<{ id: string; name: string; kind: string; refund: number }>(sql`
    SELECT pm.id, pm.name, pm.kind, SUM(r.refund_minor) AS refund
    FROM sale_returns r JOIN payment_modes pm ON pm.id = r.refund_mode_id
    WHERE r.branch_id = ${ctx.branchId} AND r.created_at >= ${range.startIso} AND r.created_at < ${range.endIso}
    GROUP BY pm.id`);
  const modes = new Map<string, ReportRow>();
  const mode = (id: string, name: string, kind: string): ReportRow => {
    let row = modes.get(id);
    if (!row) {
      row = { mode: name, kind, payments: 0, received: 0, refunds: 0, net: 0 };
      modes.set(id, row);
    }
    return row;
  };
  for (const t of taken) {
    const row = mode(t.id, t.name, t.kind);
    row.payments = num(t.n);
    row.received = num(t.amount);
  }
  for (const f of refunded) mode(f.id, f.name, f.kind).refunds = num(f.refund);
  const rows = [...modes.values()].map((r) => ({ ...r, net: num(r.received) - num(r.refunds) }));
  rows.sort((a, b) => num(b.net) - num(a.net));
  return {
    id: 'sales-by-payment-mode',
    title: 'Sales by payment mode',
    columns: [
      { key: 'mode', label: 'Payment mode', type: 'text' },
      { key: 'kind', label: 'Kind', type: 'text' },
      qty('payments', 'Payments'),
      money('received', 'Received'),
      money('refunds', 'Refunded'),
      money('net', 'Net'),
    ],
    rows,
    totals: sumRows(rows, ['payments', 'received', 'refunds', 'net']),
    note: 'Cash is shown after change was given. Sales on account appear under their own mode.',
  };
};

export const discounts: ReportRunner = (db, ctx, filters) => {
  const range = resolveRange(db, ctx, filters);
  const cap = clampLimit(filters.limit, 5_000);
  const like = likePattern(filters.q);
  const found = db.all<{
    doc_no: string;
    at: string;
    cashier: string | null;
    gross: number;
    disc: number;
    total: number;
  }>(sql`
    SELECT s.doc_no, strftime('%Y-%m-%d %H:%M', s.created_at, ${range.localMod}) AS at,
      u.full_name AS cashier, s.gross_minor AS gross, s.discount_minor AS disc, s.grand_total_minor AS total
    FROM sales s LEFT JOIN users u ON u.id = s.created_by
    WHERE s.branch_id = ${ctx.branchId} AND s.status = 'posted' AND s.discount_minor > 0
      AND s.created_at >= ${range.startIso} AND s.created_at < ${range.endIso}
      ${like ? sql`AND (lower(s.doc_no) LIKE ${like} ESCAPE '\\' OR lower(COALESCE(u.full_name, '')) LIKE ${like} ESCAPE '\\')` : sql``}
    ORDER BY s.discount_minor DESC
    LIMIT ${cap + 1}`);
  const { rows: page, truncated } = cut(found, cap);
  const rows: ReportRow[] = page.map((r) => ({
    docNo: r.doc_no,
    time: r.at,
    cashier: r.cashier,
    gross: num(r.gross),
    discount: num(r.disc),
    discountPct: percent(num(r.disc), num(r.gross)),
    total: num(r.total),
  }));
  const totals = sumRows(rows, ['gross', 'discount', 'total']);
  totals.discountPct = percent(num(totals.discount), num(totals.gross));
  return {
    id: 'discounts',
    title: 'Discounts given',
    columns: [
      { key: 'docNo', label: 'Invoice', type: 'text' },
      { key: 'time', label: 'Time', type: 'datetime' },
      { key: 'cashier', label: 'Cashier', type: 'text' },
      money('gross', 'Gross'),
      money('discount', 'Discount'),
      { key: 'discountPct', label: 'Discount %', type: 'percent', align: 'end' },
      money('total', 'Total'),
    ],
    rows,
    totals,
    note: 'Posted invoices with a discount, largest first. Totals add up the rows shown.',
    truncated,
  };
};
