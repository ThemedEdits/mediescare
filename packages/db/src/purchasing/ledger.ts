import { and, eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '../client';
import type { WriteContext } from '../context';
import { DomainError } from '../errors';
import { grns, paymentModes, supplierPayments, suppliers } from '../schema/sqlite-all';
import { payableMinor } from './payments';

export type LedgerEntryKind = 'opening' | 'bill' | 'payment';

export interface LedgerEntry {
  date: string;
  kind: LedgerEntryKind;
  docId: string | null;
  docNo: string;
  description: string;
  /** What we owe goes up. */
  debitMinor: number;
  /** What we owe goes down. */
  creditMinor: number;
  balanceMinor: number;
}

export interface AgingBuckets {
  notDue: number;
  days1to30: number;
  days31to60: number;
  days61to90: number;
  over90: number;
}

export interface SupplierLedger {
  supplier: { id: string; name: string; termsDays: number; openingBalanceMinor: number };
  entries: LedgerEntry[];
  balanceMinor: number;
  aging: AgingBuckets;
}

const DAY = 86_400_000;
const dayOf = (iso: string): string => iso.slice(0, 10);
const daysBetween = (from: string, to: string): number =>
  Math.trunc((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

export interface OpenBill {
  grnId: string;
  docNo: string;
  supplierInvoiceNo: string | null;
  billDate: string;
  dueDate: string;
  payableMinor: number;
  paidMinor: number;
  outstandingMinor: number;
}

/**
 * Balance owed = opening balance + bills (total less WHT) - payments.
 * Aging treats payments that were not tied to a bill (on account) as settling the oldest amounts first (FIFO),
 * so an advance never hides an old overdue bill.
 */
function computeAging(
  openingMinor: number,
  bills: { date: string; due: string; amount: number }[],
  totalPaid: number,
  today: string,
): AgingBuckets {
  const pieces = [
    { due: '0000-00-00', amount: openingMinor },
    ...bills.map((b) => ({ due: b.due, amount: b.amount })),
  ].filter((p) => p.amount > 0);
  pieces.sort((a, b) => a.due.localeCompare(b.due));
  let credit = totalPaid;
  const out: AgingBuckets = { notDue: 0, days1to30: 0, days31to60: 0, days61to90: 0, over90: 0 };
  for (const piece of pieces) {
    const used = Math.min(credit, piece.amount);
    credit -= used;
    const open = piece.amount - used;
    if (open === 0) continue;
    const late = piece.due === '0000-00-00' ? 1 : daysBetween(piece.due, today);
    if (late <= 0) out.notDue += open;
    else if (late <= 30) out.days1to30 += open;
    else if (late <= 60) out.days31to60 += open;
    else if (late <= 90) out.days61to90 += open;
    else out.over90 += open;
  }
  return out;
}

const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

export function getSupplierLedger(
  db: DbOrTx,
  ctx: WriteContext,
  supplierId: string,
  today: string,
  range: { from?: string; to?: string } = {},
): SupplierLedger {
  const supplier = db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.id, supplierId), eq(suppliers.tenantId, ctx.tenantId)))
    .get();
  if (!supplier) throw new DomainError('NOT_FOUND', 'Supplier not found');
  const bills = db
    .select()
    .from(grns)
    .where(and(eq(grns.supplierId, supplierId), eq(grns.branchId, ctx.branchId)))
    .all();
  const pays = db
    .select({ p: supplierPayments, mode: paymentModes.name })
    .from(supplierPayments)
    .innerJoin(paymentModes, eq(paymentModes.id, supplierPayments.modeId))
    .where(
      and(eq(supplierPayments.supplierId, supplierId), eq(supplierPayments.branchId, ctx.branchId)),
    )
    .all();

  const all: Omit<LedgerEntry, 'balanceMinor'>[] = [
    ...bills.map((g) => ({
      date: dayOf(g.createdAt),
      kind: 'bill' as const,
      docId: g.id,
      docNo: g.docNo,
      description: g.supplierInvoiceNo ? `Bill ${g.supplierInvoiceNo}` : 'Stock received',
      debitMinor: payableMinor(g),
      creditMinor: 0,
      sort: g.createdAt,
    })),
    ...pays.map(({ p, mode }) => ({
      date: dayOf(p.paidAt),
      kind: 'payment' as const,
      docId: p.id,
      docNo: p.docNo,
      description: `Payment by ${mode}${p.reference ? ` (${p.reference})` : ''}`,
      debitMinor: 0,
      creditMinor: p.amountMinor,
      sort: p.paidAt,
    })),
  ]
    .sort((a, b) => a.sort.localeCompare(b.sort))
    .map(({ sort: _sort, ...rest }) => rest);

  let running = supplier.openingBalanceMinor;
  const withBalance: LedgerEntry[] = [
    {
      date: '',
      kind: 'opening',
      docId: null,
      docNo: '',
      description: 'Opening balance',
      debitMinor: Math.max(0, supplier.openingBalanceMinor),
      creditMinor: Math.max(0, -supplier.openingBalanceMinor),
      balanceMinor: running,
    },
    ...all.map((e) => {
      running += e.debitMinor - e.creditMinor;
      return { ...e, balanceMinor: running };
    }),
  ];
  const entries = withBalance.filter(
    (e) =>
      e.kind === 'opening' ||
      ((!range.from || e.date >= range.from) && (!range.to || e.date <= range.to)),
  );

  const aging = computeAging(
    supplier.openingBalanceMinor,
    bills.map((g) => ({
      date: dayOf(g.createdAt),
      due: addDays(g.supplierInvoiceDate ?? dayOf(g.createdAt), supplier.termsDays),
      amount: payableMinor(g),
    })),
    pays.reduce((s, { p }) => s + p.amountMinor, 0),
    today,
  );
  return {
    supplier: {
      id: supplier.id,
      name: supplier.name,
      termsDays: supplier.termsDays,
      openingBalanceMinor: supplier.openingBalanceMinor,
    },
    entries,
    balanceMinor: running,
    aging,
  };
}

export interface SupplierBalanceRow {
  supplierId: string;
  name: string;
  phone: string | null;
  termsDays: number;
  balanceMinor: number;
  lastPaymentAt: string | null;
}

/** Everyone we owe (or who owes us, when negative), largest first. One query, suited to hundreds of suppliers. */
export function listSupplierBalances(
  db: DbOrTx,
  ctx: WriteContext,
  opts: { q?: string; onlyOwing?: boolean } = {},
): SupplierBalanceRow[] {
  const q = opts.q?.trim();
  const rows = db.all<{
    id: string;
    name: string;
    phone: string | null;
    terms: number;
    bal: number;
    last_pay: string | null;
  }>(sql`
    SELECT s.id, s.name, s.phone, s.terms_days AS terms,
      s.opening_balance_minor
        + COALESCE((SELECT SUM(g.total_minor - g.wht_minor) FROM grns g WHERE g.supplier_id = s.id AND g.branch_id = ${ctx.branchId}), 0)
        - COALESCE((SELECT SUM(p.amount_minor) FROM supplier_payments p WHERE p.supplier_id = s.id AND p.branch_id = ${ctx.branchId}), 0) AS bal,
      (SELECT MAX(p.paid_at) FROM supplier_payments p WHERE p.supplier_id = s.id AND p.branch_id = ${ctx.branchId}) AS last_pay
    FROM suppliers s
    WHERE s.tenant_id = ${ctx.tenantId} AND s.is_active = 1 ${q ? sql`AND s.name LIKE ${`%${q}%`}` : sql``}
    ORDER BY s.name`);
  const mapped = rows.map((r) => ({
    supplierId: r.id,
    name: r.name,
    phone: r.phone,
    termsDays: Number(r.terms),
    balanceMinor: Number(r.bal),
    lastPaymentAt: r.last_pay,
  }));
  return (opts.onlyOwing ? mapped.filter((r) => r.balanceMinor !== 0) : mapped).sort(
    (a, b) => b.balanceMinor - a.balanceMinor || a.name.localeCompare(b.name),
  );
}

/** Bills that still owe money, oldest due first: the list shown when paying a supplier. */
export function listOpenBills(db: DbOrTx, ctx: WriteContext, supplierId: string): OpenBill[] {
  const supplier = db
    .select({ terms: suppliers.termsDays })
    .from(suppliers)
    .where(and(eq(suppliers.id, supplierId), eq(suppliers.tenantId, ctx.tenantId)))
    .get();
  if (!supplier) throw new DomainError('NOT_FOUND', 'Supplier not found');
  return db
    .select()
    .from(grns)
    .where(and(eq(grns.supplierId, supplierId), eq(grns.branchId, ctx.branchId)))
    .all()
    .map((g): OpenBill => {
      const billDate = g.supplierInvoiceDate ?? dayOf(g.createdAt);
      return {
        grnId: g.id,
        docNo: g.docNo,
        supplierInvoiceNo: g.supplierInvoiceNo,
        billDate,
        dueDate: addDays(billDate, supplier.terms),
        payableMinor: payableMinor(g),
        paidMinor: g.paidMinor,
        outstandingMinor: payableMinor(g) - g.paidMinor,
      };
    })
    .filter((b) => b.outstandingMinor > 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}
