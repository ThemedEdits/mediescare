import { and, eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '../client';
import type { WriteContext } from '../context';
import { DomainError } from '../errors';
import {
  batches,
  grnLines,
  grns,
  items,
  purchaseOrders,
  suppliers,
  units,
} from '../schema/sqlite-all';
import { payableMinor } from './payments';

export interface BillRow {
  id: string;
  docNo: string;
  supplierId: string;
  supplierName: string;
  supplierInvoiceNo: string | null;
  supplierInvoiceDate: string | null;
  poDocNo: string | null;
  totalMinor: number;
  whtMinor: number;
  payableMinor: number;
  paidMinor: number;
  outstandingMinor: number;
  createdAt: string;
}

export function listGrns(
  db: DbOrTx,
  ctx: WriteContext,
  opts: {
    supplierId?: string;
    from?: string;
    to?: string;
    unpaidOnly?: boolean;
    q?: string;
    page?: number;
    pageSize?: number;
  } = {},
): { rows: BillRow[]; total: number } {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 25, 1), 200);
  const offset = (Math.max(opts.page ?? 1, 1) - 1) * pageSize;
  const q = opts.q?.trim();
  const where = sql`g.branch_id = ${ctx.branchId}
    ${opts.supplierId ? sql`AND g.supplier_id = ${opts.supplierId}` : sql``}
    ${opts.from ? sql`AND substr(g.created_at, 1, 10) >= ${opts.from}` : sql``}
    ${opts.to ? sql`AND substr(g.created_at, 1, 10) <= ${opts.to}` : sql``}
    ${opts.unpaidOnly ? sql`AND g.total_minor - g.wht_minor - g.paid_minor > 0` : sql``}
    ${q ? sql`AND (g.doc_no LIKE ${`%${q}%`} OR g.supplier_invoice_no LIKE ${`%${q}%`} OR s.name LIKE ${`%${q}%`})` : sql``}`;
  const total =
    db.get<{ n: number }>(
      sql`SELECT count(*) AS n FROM grns g JOIN suppliers s ON s.id = g.supplier_id WHERE ${where}`,
    )?.n ?? 0;
  const rows = db.all<{
    id: string;
    doc_no: string;
    sid: string;
    sname: string;
    inv: string | null;
    inv_date: string | null;
    po_no: string | null;
    total: number;
    wht: number;
    paid: number;
    created: string;
  }>(sql`
    SELECT g.id, g.doc_no, s.id AS sid, s.name AS sname, g.supplier_invoice_no AS inv, g.supplier_invoice_date AS inv_date,
      (SELECT p.doc_no FROM purchase_orders p WHERE p.id = g.po_id) AS po_no, g.total_minor AS total, g.wht_minor AS wht, g.paid_minor AS paid, g.created_at AS created
    FROM grns g JOIN suppliers s ON s.id = g.supplier_id
    WHERE ${where} ORDER BY g.created_at DESC LIMIT ${pageSize} OFFSET ${offset}`);
  return {
    total: Number(total),
    rows: rows.map((r) => {
      const payable = payableMinor({ totalMinor: Number(r.total), whtMinor: Number(r.wht) });
      return {
        id: r.id,
        docNo: r.doc_no,
        supplierId: r.sid,
        supplierName: r.sname,
        supplierInvoiceNo: r.inv,
        supplierInvoiceDate: r.inv_date,
        poDocNo: r.po_no,
        totalMinor: Number(r.total),
        whtMinor: Number(r.wht),
        payableMinor: payable,
        paidMinor: Number(r.paid),
        outstandingMinor: payable - Number(r.paid),
        createdAt: r.created,
      };
    }),
  };
}

export interface GrnDetail extends BillRow {
  subTotalMinor: number;
  discountMinor: number;
  salesTaxMinor: number;
  advanceTaxMinor: number;
  freightMinor: number;
  stockNote: string | null;
  lines: {
    lineNo: number;
    itemName: string;
    unitName: string;
    batchNo: string;
    expiryDate: string;
    qtyUnits: number;
    qtyBase: number;
    bonusQtyBase: number;
    costUnitMicro: number;
    lineTotalMinor: number;
  }[];
}

export function getGrn(db: DbOrTx, ctx: WriteContext, id: string): GrnDetail {
  const g = db
    .select({ g: grns, supplierName: suppliers.name, poDocNo: purchaseOrders.docNo })
    .from(grns)
    .innerJoin(suppliers, eq(suppliers.id, grns.supplierId))
    .leftJoin(purchaseOrders, eq(purchaseOrders.id, grns.poId))
    .where(and(eq(grns.id, id), eq(grns.branchId, ctx.branchId)))
    .get();
  if (!g) throw new DomainError('NOT_FOUND', 'Bill not found');
  const lines = db
    .select({
      l: grnLines,
      itemName: items.name,
      unitName: units.name,
      batchNo: batches.batchNo,
      expiryDate: batches.expiryDate,
    })
    .from(grnLines)
    .innerJoin(items, eq(items.id, grnLines.itemId))
    .innerJoin(units, eq(units.id, grnLines.unitId))
    .innerJoin(batches, eq(batches.id, grnLines.batchId))
    .where(eq(grnLines.grnId, id))
    .orderBy(grnLines.lineNo)
    .all();
  const payable = payableMinor(g.g);
  return {
    id: g.g.id,
    docNo: g.g.docNo,
    supplierId: g.g.supplierId,
    supplierName: g.supplierName,
    supplierInvoiceNo: g.g.supplierInvoiceNo,
    supplierInvoiceDate: g.g.supplierInvoiceDate,
    poDocNo: g.poDocNo,
    totalMinor: g.g.totalMinor,
    whtMinor: g.g.whtMinor,
    payableMinor: payable,
    paidMinor: g.g.paidMinor,
    outstandingMinor: payable - g.g.paidMinor,
    createdAt: g.g.createdAt,
    subTotalMinor: g.g.subTotalMinor,
    discountMinor: g.g.discountMinor,
    salesTaxMinor: g.g.salesTaxMinor,
    advanceTaxMinor: g.g.advanceTaxMinor,
    freightMinor: g.g.freightMinor,
    stockNote: g.g.stockNote,
    lines: lines.map(({ l, itemName, unitName, batchNo, expiryDate }) => ({
      lineNo: l.lineNo,
      itemName,
      unitName,
      batchNo,
      expiryDate,
      qtyUnits: l.qtyUnits,
      qtyBase: l.qtyBase,
      bonusQtyBase: l.bonusQtyBase,
      costUnitMicro: l.costUnitMicro,
      lineTotalMinor: l.lineTotalMinor,
    })),
  };
}
