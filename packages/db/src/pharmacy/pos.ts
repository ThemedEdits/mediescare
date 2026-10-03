import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  StockError,
  allocateFefo,
  computeBill,
  costOfSaleMinor,
  proportionMinor,
  settlePayments,
  toBaseQty,
  PaymentError,
  type BillDiscount,
  type BillTotals,
  type PricedLine,
  type StockBatch,
  type TenderedPayment,
} from '@mediescare/core';
import { newId } from '@mediescare/sync';
import { appendAudit } from '../audit';
import { loadAccessContext } from '../auth/access';
import type { Db, DbOrTx } from '../client';
import { isoNow, type WriteContext } from '../context';
import { DomainError } from '../errors';
import { consumeOverride, roleLimitsFor } from '../overrides';
import { recordChange } from '../outbox';
import {
  customers,
  holdInvoices,
  itemUnits,
  items,
  missedSales,
  narcoticRegister,
  paymentModes,
  saleLineAllocations,
  saleLines,
  salePayments,
  saleReturnLines,
  saleReturns,
  sales,
  shifts,
  stockMovements,
} from '../schema/sqlite-all';
import { getPosRounding } from '../settings';
import { branchToday, nextDocNo } from './common';
import { getBatchStock, postMovement, type PostedMovement } from './stock';

// ------------------------------------------------------------------------------------------------
// Shifts
// ------------------------------------------------------------------------------------------------

export function getOpenShift(db: DbOrTx, branchId: string, userId: string) {
  return (
    db
      .select()
      .from(shifts)
      .where(
        and(eq(shifts.branchId, branchId), eq(shifts.openedBy, userId), eq(shifts.status, 'open')),
      )
      .get() ?? null
  );
}

/** Open a cashier shift with an opening float. One open shift per user at a branch. */
export function openShift(
  db: Db,
  ctx: WriteContext,
  input: { floatMinor: number },
): { id: string; docNo: string } {
  if (!ctx.userId) throw new DomainError('INVALID', 'Sign in first');
  const userId = ctx.userId;
  if (!Number.isSafeInteger(input.floatMinor) || input.floatMinor < 0)
    throw new DomainError('INVALID', 'Opening cash must be zero or more');
  return db.transaction((tx) => {
    if (getOpenShift(tx, ctx.branchId, userId))
      throw new DomainError('CONFLICT', 'You already have an open shift. Close it first');
    const now = isoNow(ctx);
    const id = newId();
    const docNo = nextDocNo(tx, ctx, 'SHF');
    const row = {
      id,
      tenantId: ctx.tenantId,
      branchId: ctx.branchId,
      docNo,
      openedBy: userId,
      openedAt: now,
      floatMinor: input.floatMinor,
      status: 'open',
      closedBy: null,
      closedAt: null,
      expectedCashMinor: null,
      countedCashMinor: null,
      varianceMinor: null,
      countJson: null,
      deviceId: ctx.deviceId,
      createdAt: now,
      updatedAt: now,
      hlc: ctx.clock.tick(),
      version: 1,
    };
    tx.insert(shifts).values(row).run();
    recordChange(tx, ctx, { entityType: 'shifts', entityId: id, op: 'insert', payload: row });
    appendAudit(tx, ctx, {
      action: 'shift.open',
      entityType: 'shift',
      entityId: id,
      newValue: { docNo, floatMinor: input.floatMinor },
    });
    return { id, docNo };
  });
}

/**
 * Cash the drawer should hold: float + cash taken on posted sales - cash refunded on returns in this shift
 * - cash expenses paid from this shift's till (posted, not void). Back-office cash (supplier payments, expenses
 * not taken from the till) never changes it.
 */
export function expectedCashMinor(db: DbOrTx, shiftId: string): number {
  const shift = db.select().from(shifts).where(eq(shifts.id, shiftId)).get();
  if (!shift) throw new DomainError('NOT_FOUND', 'Shift not found');
  const cashIn = db.get<{ v: number }>(sql`
    SELECT COALESCE(SUM(p.amount_minor), 0) AS v FROM sale_payments p
    JOIN sales s ON s.id = p.sale_id
    WHERE s.shift_id = ${shiftId} AND s.status = 'posted' AND p.kind = 'cash'`);
  const cashOut = db.get<{ v: number }>(sql`
    SELECT COALESCE(SUM(r.refund_minor), 0) AS v FROM sale_returns r
    JOIN payment_modes m ON m.id = r.refund_mode_id
    WHERE r.shift_id = ${shiftId} AND m.kind = 'cash'`);
  const tillExpenses = db.get<{ v: number }>(sql`
    SELECT COALESCE(SUM(e.amount_minor), 0) AS v FROM expenses e
    JOIN payment_modes m ON m.id = e.mode_id
    WHERE e.shift_id = ${shiftId} AND e.status = 'posted' AND m.kind = 'cash'`);
  return (
    shift.floatMinor +
    Number(cashIn?.v ?? 0) -
    Number(cashOut?.v ?? 0) -
    Number(tillExpenses?.v ?? 0)
  );
}

export interface CloseShiftInput {
  shiftId: string;
  /** Blind count: the cashier types what is in the drawer without being shown the expected amount. */
  countedCashMinor: number;
  denominations?: Record<string, number>;
}

export interface ShiftCloseResult {
  expectedCashMinor: number;
  countedCashMinor: number;
  varianceMinor: number;
}

export function closeShift(db: Db, ctx: WriteContext, input: CloseShiftInput): ShiftCloseResult {
  if (!Number.isSafeInteger(input.countedCashMinor) || input.countedCashMinor < 0)
    throw new DomainError('INVALID', 'Counted cash must be zero or more');
  return db.transaction((tx) => {
    const shift = tx
      .select()
      .from(shifts)
      .where(and(eq(shifts.id, input.shiftId), eq(shifts.branchId, ctx.branchId)))
      .get();
    if (!shift) throw new DomainError('NOT_FOUND', 'Shift not found');
    if (shift.status !== 'open') throw new DomainError('CONFLICT', 'This shift is already closed');
    const expected = expectedCashMinor(tx, shift.id);
    const variance = input.countedCashMinor - expected;
    const now = isoNow(ctx);
    const change = {
      status: 'closed',
      closedBy: ctx.userId,
      closedAt: now,
      expectedCashMinor: expected,
      countedCashMinor: input.countedCashMinor,
      varianceMinor: variance,
      countJson: input.denominations ? JSON.stringify(input.denominations) : null,
      version: shift.version + 1,
      updatedAt: now,
      hlc: ctx.clock.tick(),
    };
    tx.update(shifts).set(change).where(eq(shifts.id, shift.id)).run();
    recordChange(tx, ctx, {
      entityType: 'shifts',
      entityId: shift.id,
      op: 'update',
      payload: { id: shift.id, ...change, baseVersion: shift.version },
    });
    appendAudit(tx, ctx, {
      action: 'shift.close',
      entityType: 'shift',
      entityId: shift.id,
      newValue: {
        expectedCashMinor: expected,
        countedCashMinor: input.countedCashMinor,
        varianceMinor: variance,
      },
    });
    return {
      expectedCashMinor: expected,
      countedCashMinor: input.countedCashMinor,
      varianceMinor: variance,
    };
  });
}

// ------------------------------------------------------------------------------------------------
// Sale
// ------------------------------------------------------------------------------------------------

export interface NarcoticInfo {
  patientName: string;
  patientCnic: string;
  doctorName: string;
  prescriptionRef?: string;
}

export interface SaleLineInput {
  itemId: string;
  unitId: string;
  /** Whole number of the chosen unit (strips, tablets ...). */
  qty: number;
  /** Cashier chose this batch by hand. Still refused if expired or blocked. */
  batchId?: string;
  /** Per smallest unit, micro-PKR. Only when the price is changed at the counter. */
  rateUnitMicro?: number;
  discountBp?: number;
  discountMinor?: number;
  narcotic?: NarcoticInfo;
}

export interface SalePaymentInput {
  modeId: string;
  amountMinor: number;
  reference?: string;
}

export interface CreateSaleInput {
  /** Generated by the POS for every save attempt. A retry with the same key returns the same sale. */
  idempotencyKey: string;
  customerId?: string | null;
  lines: SaleLineInput[];
  billDiscount?: BillDiscount;
  payments: SalePaymentInput[];
  note?: string;
  /** Manager approval for a discount above the cashier's limit. */
  discountOverrideId?: string;
  /** Manager approval for a changed price or a price below cost. */
  priceOverrideId?: string;
}

export interface SaleLineResult {
  id: string;
  lineNo: number;
  itemId: string;
  name: string;
  qtyUnits: number;
  unitId: string;
  qtyBase: number;
  rateUnitMicro: number;
  grossMinor: number;
  discountMinor: number;
  taxMinor: number;
  netMinor: number;
  costMinor: number;
  batches: { batchId: string; qtyBase: number; costUnitMicro: number }[];
}

export interface SaleResult {
  id: string;
  docNo: string;
  replay: boolean;
  grossMinor: number;
  discountMinor: number;
  taxMinor: number;
  roundingMinor: number;
  grandTotalMinor: number;
  paidMinor: number;
  dueMinor: number;
  changeMinor: number;
  costMinor: number;
  profitMinor: number;
  lines: SaleLineResult[];
}

const CNIC = /^\d{5}-?\d{7}-?\d$/;

function toDomainStockError(error: unknown, itemName: string): never {
  if (error instanceof StockError) {
    if (error.code === 'INSUFFICIENT_STOCK')
      throw new DomainError('INSUFFICIENT_STOCK', `${itemName}: ${error.message}`, error.details);
    if (error.code === 'EXPIRED_BATCH')
      throw new DomainError('EXPIRED_BATCH', `${itemName}: ${error.message}`);
    throw new DomainError('INVALID', `${itemName}: ${error.message}`);
  }
  throw error;
}

function loadSale(db: DbOrTx, saleId: string): SaleResult {
  const s = db.select().from(sales).where(eq(sales.id, saleId)).get();
  if (!s) throw new DomainError('NOT_FOUND', 'Sale not found');
  const ls = db
    .select({ l: saleLines, name: items.name })
    .from(saleLines)
    .innerJoin(items, eq(items.id, saleLines.itemId))
    .where(eq(saleLines.saleId, saleId))
    .orderBy(asc(saleLines.lineNo))
    .all();
  const allocs = ls.length
    ? db
        .select()
        .from(saleLineAllocations)
        .where(
          inArray(
            saleLineAllocations.saleLineId,
            ls.map((l) => l.l.id),
          ),
        )
        .all()
    : [];
  return {
    id: s.id,
    docNo: s.docNo,
    replay: false,
    grossMinor: s.grossMinor,
    discountMinor: s.discountMinor,
    taxMinor: s.taxMinor,
    roundingMinor: s.roundingMinor,
    grandTotalMinor: s.grandTotalMinor,
    paidMinor: s.paidMinor,
    dueMinor: s.dueMinor,
    changeMinor: s.changeMinor,
    costMinor: s.costMinor,
    profitMinor: ls.reduce((sum, l) => sum + (l.l.netMinor - l.l.taxMinor - l.l.costMinor), 0),
    lines: ls.map(({ l, name }) => ({
      id: l.id,
      lineNo: l.lineNo,
      itemId: l.itemId,
      name,
      qtyUnits: l.qtyUnits,
      unitId: l.unitId,
      qtyBase: l.qtyBase,
      rateUnitMicro: l.rateUnitMicro,
      grossMinor: l.grossMinor,
      discountMinor: l.lineDiscountMinor + l.billDiscountShareMinor,
      taxMinor: l.taxMinor,
      netMinor: l.netMinor,
      costMinor: l.costMinor,
      batches: allocs
        .filter((a) => a.saleLineId === l.id)
        .map((a) => ({ batchId: a.batchId, qtyBase: a.qtyBase, costUnitMicro: a.costUnitMicro })),
    })),
  };
}

/**
 * The sale transaction (CLAUDE.md §4.4): validate, allocate stock first-expiry-first, compute money,
 * post ledger movements, payments, narcotic register, audit and outbox, all in ONE transaction.
 * If anything fails nothing is saved. Never touches the network.
 */
export function createSale(db: Db, ctx: WriteContext, input: CreateSaleInput): SaleResult {
  if (!ctx.userId) throw new DomainError('INVALID', 'Sign in first');
  const userId = ctx.userId;
  if (input.lines.length === 0) throw new DomainError('INVALID', 'Add at least one item');
  if (!input.idempotencyKey || input.idempotencyKey.length < 8)
    throw new DomainError('INVALID', 'Missing request key');

  return db.transaction((tx) => {
    const replay = tx
      .select({ id: sales.id })
      .from(sales)
      .where(and(eq(sales.tenantId, ctx.tenantId), eq(sales.idempotencyKey, input.idempotencyKey)))
      .get();
    if (replay) return { ...loadSale(tx, replay.id), replay: true };

    const shift = getOpenShift(tx, ctx.branchId, userId);
    if (!shift) throw new DomainError('SHIFT_REQUIRED', 'Open your shift before selling');

    const today = branchToday(tx, ctx);
    const itemIds = [...new Set(input.lines.map((l) => l.itemId))];
    const itemRows = tx
      .select()
      .from(items)
      .where(and(eq(items.tenantId, ctx.tenantId), inArray(items.id, itemIds)))
      .all();
    const unitRows = tx.select().from(itemUnits).where(inArray(itemUnits.itemId, itemIds)).all();
    const actor = loadAccessContext(tx, userId);
    const limits = roleLimitsFor(tx, userId);

    // Working stock per item: several lines of one item must not allocate the same units twice.
    const working = new Map<string, StockBatch[]>();
    for (const id of itemIds)
      working.set(
        id,
        getBatchStock(tx, ctx.branchId, id).map((b) => ({ ...b })),
      );

    const priced: PricedLine[] = [];
    const prepared: {
      input: SaleLineInput;
      itemName: string;
      qtyBase: number;
      allocations: { batchId: string; qty: number; costUnitMicro: number }[];
      costMinor: number;
      isNarcotic: boolean;
      retail: number;
      rate: number;
    }[] = [];
    let priceChanged = false;

    input.lines.forEach((line, index) => {
      const item = itemRows.find((i) => i.id === line.itemId);
      if (!item || !item.isActive || item.deletedAt)
        throw new DomainError('INVALID', `Line ${index + 1}: this item is not available`);
      const unit = unitRows.find((u) => u.itemId === item.id && u.unitId === line.unitId);
      if (!unit) throw new DomainError('INVALID', `${item.name}: not sold in that unit`);
      if (!Number.isInteger(line.qty) || line.qty <= 0)
        throw new DomainError(
          'INVALID',
          `${item.name}: quantity must be a whole number above zero`,
        );
      let qtyBase: number;
      try {
        qtyBase = toBaseQty(line.qty, unit);
      } catch (e) {
        throw new DomainError('INVALID', `${item.name}: ${(e as Error).message}`);
      }
      const rate = line.rateUnitMicro ?? item.retailRateUnitMicro;
      if (!Number.isSafeInteger(rate) || rate <= 0)
        throw new DomainError('INVALID', `${item.name} has no selling price`);
      if (rate !== item.retailRateUnitMicro) {
        priceChanged = true;
        const reductionBp =
          rate < item.retailRateUnitMicro
            ? Math.ceil(((item.retailRateUnitMicro - rate) * 10_000) / item.retailRateUnitMicro)
            : 0;
        const raised = rate > item.retailRateUnitMicro;
        const allowed =
          actor?.permissions.has('pharmacy.price.override_price') &&
          !raised &&
          reductionBp <= limits.priceBp;
        if (!allowed && !input.priceOverrideId) {
          throw new DomainError(
            'OVERRIDE_REQUIRED',
            `${item.name}: changing the price needs manager approval`,
            { kind: 'override_price', percentBp: reductionBp },
          );
        }
      }

      const stock = working.get(item.id) as StockBatch[];
      let allocation;
      try {
        const fallback = item.allowNegativeStock
          ? stock.filter((b) => !b.blocked && b.expiryDate >= today).at(-1)?.id
          : undefined;
        allocation = allocateFefo(stock, qtyBase, today, {
          preferredBatchId: line.batchId,
          allowNegativeOnBatchId: fallback,
        });
      } catch (e) {
        toDomainStockError(e, item.name);
      }
      for (const a of allocation.allocations) {
        const b = stock.find((x) => x.id === a.batchId);
        if (b) b.available -= a.qty;
      }
      priced.push({
        qtyBase,
        rateUnitMicro: rate,
        discountBp: line.discountBp,
        discountMinor: line.discountMinor,
        taxBp: item.taxBp,
        taxInclusive: item.taxInclusive,
      });
      prepared.push({
        input: line,
        itemName: item.name,
        qtyBase,
        allocations: allocation.allocations,
        costMinor: costOfSaleMinor(allocation.allocations),
        isNarcotic: item.isNarcotic,
        retail: item.retailRateUnitMicro,
        rate,
      });
      if (item.isNarcotic) {
        const n = line.narcotic;
        if (
          !n ||
          n.patientName.trim().length < 2 ||
          !CNIC.test(n.patientCnic.trim()) ||
          n.doctorName.trim().length < 2
        ) {
          throw new DomainError(
            'INVALID',
            `${item.name} is a controlled item: enter the patient name, CNIC and the doctor`,
          );
        }
      }
    });

    let bill: BillTotals;
    try {
      bill = computeBill({
        lines: priced,
        billDiscount: input.billDiscount,
        rounding: getPosRounding(tx, ctx),
      });
    } catch (e) {
      throw new DomainError('INVALID', (e as Error).message);
    }

    // Discount above the cashier's limit needs a manager (permissions-matrix.md §5).
    const discountBp =
      bill.grossMinor === 0 ? 0 : Math.ceil((bill.totalDiscountMinor * 10_000) / bill.grossMinor);
    if (discountBp > limits.discountBp) {
      if (!input.discountOverrideId) {
        throw new DomainError(
          'OVERRIDE_REQUIRED',
          'This discount is above your limit. A manager must approve it',
          { kind: 'discount', percentBp: discountBp },
        );
      }
      consumeOverride(tx, ctx, {
        overrideId: input.discountOverrideId,
        kind: 'discount',
        requesterId: userId,
        reference: `sale:${input.idempotencyKey}`,
      });
    }

    // Selling below batch cost silently loses money: always needs a manager, even if the price change itself is allowed.
    const belowCost = bill.lines.some(
      (l, i) => l.revenueExTaxMinor < (prepared[i] as { costMinor: number }).costMinor,
    );
    if (belowCost && !input.priceOverrideId) {
      throw new DomainError(
        'OVERRIDE_REQUIRED',
        'One line is priced below its cost. A manager must approve it',
        { kind: 'override_price', percentBp: 0 },
      );
    }
    if (input.priceOverrideId && (priceChanged || belowCost)) {
      consumeOverride(tx, ctx, {
        overrideId: input.priceOverrideId,
        kind: 'override_price',
        requesterId: userId,
        reference: `sale:${input.idempotencyKey}`,
      });
    }

    // Payments
    const modes = tx
      .select()
      .from(paymentModes)
      .where(and(eq(paymentModes.tenantId, ctx.tenantId), eq(paymentModes.isActive, true)))
      .all();
    const tendered: TenderedPayment[] = [];
    let onAccount = false;
    const modeOf = new Map<string, (typeof modes)[number]>();
    for (const p of input.payments) {
      const mode = modes.find((m) => m.id === p.modeId);
      if (!mode) throw new DomainError('INVALID', 'Unknown payment method');
      modeOf.set(mode.kind, mode);
      if (mode.kind === 'credit') {
        onAccount = true;
        continue;
      }
      tendered.push({ kind: mode.kind as TenderedPayment['kind'], amountMinor: p.amountMinor });
    }
    const customer = input.customerId
      ? tx
          .select()
          .from(customers)
          .where(and(eq(customers.id, input.customerId), eq(customers.tenantId, ctx.tenantId)))
          .get()
      : undefined;
    if (input.customerId && !customer) throw new DomainError('INVALID', 'Customer not found');
    let settlement;
    try {
      settlement = settlePayments(bill.grandTotalMinor, tendered, { allowDue: onAccount });
    } catch (e) {
      if (e instanceof PaymentError) throw new DomainError('INVALID', e.message);
      throw e;
    }
    if (settlement.dueMinor > 0) {
      if (!customer || customer.isWalkin)
        throw new DomainError('INVALID', 'Choose a registered customer to sell on account');
      if (settlement.dueMinor > customer.creditLimitMinor)
        throw new DomainError('INVALID', 'This is above the customer credit limit');
    }

    // Persist
    const now = isoNow(ctx);
    const saleId = newId();
    const docNo = nextDocNo(tx, ctx, 'INV');
    const costMinor = prepared.reduce((s, p) => s + p.costMinor, 0);
    const header = {
      id: saleId,
      tenantId: ctx.tenantId,
      branchId: ctx.branchId,
      docNo,
      customerId: customer?.id ?? null,
      shiftId: shift.id,
      status: 'posted',
      source: 'pos',
      grossMinor: bill.grossMinor,
      discountMinor: bill.totalDiscountMinor,
      taxMinor: bill.taxMinor,
      roundingMinor: bill.roundingMinor,
      grandTotalMinor: bill.grandTotalMinor,
      paidMinor: settlement.paidMinor,
      dueMinor: settlement.dueMinor,
      changeMinor: settlement.changeMinor,
      costMinor,
      note: input.note ?? null,
      createdBy: userId,
      deviceId: ctx.deviceId,
      idempotencyKey: input.idempotencyKey,
      voidedBy: null,
      voidedAt: null,
      voidReason: null,
      createdAt: now,
      updatedAt: now,
      hlc: ctx.clock.tick(),
      version: 1,
    };
    tx.insert(sales).values(header).run();

    const linePayload: (typeof saleLines.$inferInsert)[] = [];
    const allocPayload: (typeof saleLineAllocations.$inferInsert)[] = [];
    const movements: PostedMovement[] = [];
    const registerRows: (typeof narcoticRegister.$inferInsert)[] = [];
    const lineResults: SaleLineResult[] = [];
    prepared.forEach((p, i) => {
      const t = bill.lines[i] as BillTotals['lines'][number];
      const lineId = newId();
      linePayload.push({
        id: lineId,
        saleId,
        lineNo: i + 1,
        itemId: p.input.itemId,
        unitId: p.input.unitId,
        qtyUnits: p.input.qty,
        qtyBase: p.qtyBase,
        rateUnitMicro: p.rate,
        taxBp: (priced[i] as PricedLine).taxBp,
        grossMinor: t.grossMinor,
        lineDiscountMinor: t.lineDiscountMinor,
        billDiscountShareMinor: t.billDiscountShareMinor,
        taxMinor: t.taxMinor,
        netMinor: t.netMinor,
        costMinor: p.costMinor,
      });
      for (const a of p.allocations) {
        allocPayload.push({
          id: newId(),
          saleLineId: lineId,
          batchId: a.batchId,
          qtyBase: a.qty,
          costUnitMicro: a.costUnitMicro,
          costMinor: costOfSaleMinor([a]),
        });
        movements.push(
          postMovement(tx, ctx, {
            itemId: p.input.itemId,
            batchId: a.batchId,
            kind: 'sale',
            qtyBase: a.qty,
            unitCostMicro: a.costUnitMicro,
            docType: 'sale',
            docId: saleId,
            docLineId: lineId,
          }),
        );
      }
      if (p.isNarcotic && p.input.narcotic) {
        registerRows.push({
          id: newId(),
          tenantId: ctx.tenantId,
          branchId: ctx.branchId,
          saleId,
          saleLineId: lineId,
          itemId: p.input.itemId,
          qtyBase: p.qtyBase,
          patientName: p.input.narcotic.patientName.trim(),
          patientCnic: p.input.narcotic.patientCnic.trim(),
          doctorName: p.input.narcotic.doctorName.trim(),
          prescriptionRef: p.input.narcotic.prescriptionRef ?? null,
          soldAt: now,
          soldBy: userId,
          createdAt: now,
          updatedAt: now,
          hlc: ctx.clock.tick(),
          version: 1,
        });
      }
      lineResults.push({
        id: lineId,
        lineNo: i + 1,
        itemId: p.input.itemId,
        name: p.itemName,
        qtyUnits: p.input.qty,
        unitId: p.input.unitId,
        qtyBase: p.qtyBase,
        rateUnitMicro: p.rate,
        grossMinor: t.grossMinor,
        discountMinor: t.lineDiscountMinor + t.billDiscountShareMinor,
        taxMinor: t.taxMinor,
        netMinor: t.netMinor,
        costMinor: p.costMinor,
        batches: p.allocations.map((a) => ({
          batchId: a.batchId,
          qtyBase: a.qty,
          costUnitMicro: a.costUnitMicro,
        })),
      });
    });
    tx.insert(saleLines).values(linePayload).run();
    tx.insert(saleLineAllocations).values(allocPayload).run();
    if (registerRows.length) tx.insert(narcoticRegister).values(registerRows).run();

    const paymentPayload: (typeof salePayments.$inferInsert)[] = settlement.applied.map((a) => ({
      id: newId(),
      saleId,
      modeId: (modeOf.get(a.kind) as (typeof modes)[number]).id,
      kind: a.kind,
      amountMinor: a.amountMinor,
      reference: input.payments.find((p) => p.modeId === modeOf.get(a.kind)?.id)?.reference ?? null,
      paidAt: now,
    }));
    if (paymentPayload.length) tx.insert(salePayments).values(paymentPayload).run();

    recordChange(tx, ctx, {
      entityType: 'sales',
      entityId: saleId,
      op: 'insert',
      payload: {
        ...header,
        lines: linePayload,
        allocations: allocPayload,
        payments: paymentPayload,
        movements,
        narcotic: registerRows,
      },
    });
    appendAudit(tx, ctx, {
      action: 'sale.create',
      entityType: 'sale',
      entityId: saleId,
      newValue: {
        docNo,
        grandTotalMinor: bill.grandTotalMinor,
        discountMinor: bill.totalDiscountMinor,
        lines: linePayload.length,
        shiftId: shift.id,
      },
    });

    const profit = bill.lines.reduce(
      (s, l, i) => s + l.revenueExTaxMinor - (prepared[i] as { costMinor: number }).costMinor,
      0,
    );
    return {
      id: saleId,
      docNo,
      replay: false,
      grossMinor: bill.grossMinor,
      discountMinor: bill.totalDiscountMinor,
      taxMinor: bill.taxMinor,
      roundingMinor: bill.roundingMinor,
      grandTotalMinor: bill.grandTotalMinor,
      paidMinor: settlement.paidMinor,
      dueMinor: settlement.dueMinor,
      changeMinor: settlement.changeMinor,
      costMinor,
      profitMinor: profit,
      lines: lineResults,
    };
  });
}

export function getSale(
  db: DbOrTx,
  tenantId: string,
  saleId: string,
): SaleResult & { status: string; createdAt: string; voidReason: string | null } {
  const s = db
    .select()
    .from(sales)
    .where(and(eq(sales.id, saleId), eq(sales.tenantId, tenantId)))
    .get();
  if (!s) throw new DomainError('NOT_FOUND', 'Sale not found');
  return {
    ...loadSale(db, saleId),
    status: s.status,
    createdAt: s.createdAt,
    voidReason: s.voidReason,
  };
}

export interface SaleListRow {
  id: string;
  docNo: string;
  status: string;
  grandTotalMinor: number;
  paidMinor: number;
  dueMinor: number;
  costMinor: number;
  discountMinor: number;
  createdAt: string;
  createdBy: string | null;
}

export function listSales(
  db: DbOrTx,
  branchId: string,
  opts: { from?: string; to?: string; q?: string; page?: number; pageSize?: number } = {},
): { rows: SaleListRow[]; total: number } {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 25, 1), 200);
  const offset = (Math.max(opts.page ?? 1, 1) - 1) * pageSize;
  const where = and(
    eq(sales.branchId, branchId),
    opts.from ? sql`${sales.createdAt} >= ${opts.from}` : undefined,
    opts.to ? sql`${sales.createdAt} <= ${opts.to}` : undefined,
    opts.q ? sql`${sales.docNo} LIKE ${`%${opts.q.trim()}%`}` : undefined,
  );
  const total =
    db
      .select({ n: sql<number>`count(*)` })
      .from(sales)
      .where(where)
      .get()?.n ?? 0;
  const rows = db
    .select()
    .from(sales)
    .where(where)
    .orderBy(desc(sales.createdAt))
    .limit(pageSize)
    .offset(offset)
    .all();
  return {
    total: Number(total),
    rows: rows.map((r) => ({
      id: r.id,
      docNo: r.docNo,
      status: r.status,
      grandTotalMinor: r.grandTotalMinor,
      paidMinor: r.paidMinor,
      dueMinor: r.dueMinor,
      costMinor: r.costMinor,
      discountMinor: r.discountMinor,
      createdAt: r.createdAt,
      createdBy: r.createdBy,
    })),
  };
}

// ------------------------------------------------------------------------------------------------
// Void and return
// ------------------------------------------------------------------------------------------------

export interface VoidSaleInput {
  saleId: string;
  reason: string;
  /** Needed when the user does not hold the void permission themselves. */
  overrideId?: string;
}

/**
 * Void a sale from a still-open shift: the invoice stays in the books marked void, with who, when and why,
 * and stock comes back through reversing ledger movements. Sales from closed shifts must use a return.
 */
export function voidSale(db: Db, ctx: WriteContext, input: VoidSaleInput): void {
  if (!ctx.userId) throw new DomainError('INVALID', 'Sign in first');
  const userId = ctx.userId;
  if (input.reason.trim().length < 3) throw new DomainError('INVALID', 'Give a reason for voiding');
  db.transaction((tx) => {
    const sale = tx
      .select()
      .from(sales)
      .where(and(eq(sales.id, input.saleId), eq(sales.branchId, ctx.branchId)))
      .get();
    if (!sale) throw new DomainError('NOT_FOUND', 'Sale not found');
    if (sale.status !== 'posted') throw new DomainError('CONFLICT', 'This sale is already void');
    const shift = tx.select().from(shifts).where(eq(shifts.id, sale.shiftId)).get();
    if (!shift || shift.status !== 'open')
      throw new DomainError(
        'CONFLICT',
        'This sale belongs to a closed shift. Use a return instead',
      );
    const returned = tx
      .select({ n: sql<number>`count(*)` })
      .from(saleReturns)
      .where(eq(saleReturns.saleId, sale.id))
      .get();
    if (Number(returned?.n ?? 0) > 0)
      throw new DomainError('CONFLICT', 'This sale already has a return, so it cannot be voided');

    const actor = loadAccessContext(tx, userId);
    if (!actor?.permissions.has('pharmacy.sale.void')) {
      if (!input.overrideId)
        throw new DomainError('OVERRIDE_REQUIRED', 'A manager must approve voiding a sale', {
          kind: 'void',
          amountMinor: sale.grandTotalMinor,
        });
      consumeOverride(tx, ctx, {
        overrideId: input.overrideId,
        kind: 'void',
        requesterId: userId,
        reference: `void:${sale.id}`,
        amountMinor: sale.grandTotalMinor,
      });
    }

    const moves = tx
      .select()
      .from(stockMovements)
      .where(and(eq(stockMovements.docType, 'sale'), eq(stockMovements.docId, sale.id)))
      .all();
    const reversed: PostedMovement[] = moves.map((m) =>
      postMovement(tx, ctx, {
        itemId: m.itemId,
        batchId: m.batchId,
        kind: 'sale_return',
        qtyBase: Math.abs(m.qtyBase),
        unitCostMicro: m.unitCostMicro,
        docType: 'sale_void',
        docId: sale.id,
        reversesId: m.id,
        storeId: m.storeId,
      }),
    );
    const now = isoNow(ctx);
    const change = {
      status: 'void',
      voidedBy: userId,
      voidedAt: now,
      voidReason: input.reason.trim(),
      version: sale.version + 1,
      updatedAt: now,
      hlc: ctx.clock.tick(),
    };
    tx.update(sales).set(change).where(eq(sales.id, sale.id)).run();
    recordChange(tx, ctx, {
      entityType: 'sales',
      entityId: sale.id,
      op: 'void',
      payload: { id: sale.id, ...change, reversals: reversed, baseVersion: sale.version },
    });
    appendAudit(tx, ctx, {
      action: 'sale.void',
      entityType: 'sale',
      entityId: sale.id,
      oldValue: { status: 'posted' },
      newValue: {
        status: 'void',
        reason: change.voidReason,
        grandTotalMinor: sale.grandTotalMinor,
      },
    });
  });
}

export const RETURN_REASONS = [
  'wrong_item',
  'damaged',
  'expired',
  'customer_changed_mind',
  'prescription_change',
  'other',
] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];

export interface ReturnLineInput {
  saleLineId: string;
  /** In the smallest unit. */
  qtyBase: number;
  /** false: the item is damaged and is not put back on the shelf. */
  restock: boolean;
}

export interface CreateReturnInput {
  saleId: string;
  lines: ReturnLineInput[];
  reasonCode: ReturnReason;
  reasonText?: string;
  refundModeId: string;
  overrideId?: string;
}

/** Return against an original invoice: partial or full, line by line, refunded in the chosen mode. */
export function createReturn(
  db: Db,
  ctx: WriteContext,
  input: CreateReturnInput,
): { id: string; docNo: string; refundMinor: number } {
  if (!ctx.userId) throw new DomainError('INVALID', 'Sign in first');
  const userId = ctx.userId;
  if (input.lines.length === 0) throw new DomainError('INVALID', 'Choose what is being returned');
  if (input.reasonCode === 'other' && !input.reasonText?.trim())
    throw new DomainError('INVALID', 'Describe the reason');
  return db.transaction((tx) => {
    const sale = tx
      .select()
      .from(sales)
      .where(and(eq(sales.id, input.saleId), eq(sales.branchId, ctx.branchId)))
      .get();
    if (!sale) throw new DomainError('NOT_FOUND', 'Invoice not found');
    if (sale.status !== 'posted')
      throw new DomainError('CONFLICT', 'A void invoice cannot be returned');
    const shift = getOpenShift(tx, ctx.branchId, userId);
    if (!shift) throw new DomainError('SHIFT_REQUIRED', 'Open your shift to give a refund');
    const mode = tx
      .select()
      .from(paymentModes)
      .where(and(eq(paymentModes.id, input.refundModeId), eq(paymentModes.tenantId, ctx.tenantId)))
      .get();
    if (!mode || mode.kind === 'credit')
      throw new DomainError('INVALID', 'Choose how the refund is paid');

    const lines = tx
      .select()
      .from(saleLines)
      .where(
        and(
          eq(saleLines.saleId, sale.id),
          inArray(
            saleLines.id,
            input.lines.map((l) => l.saleLineId),
          ),
        ),
      )
      .all();
    if (lines.length !== new Set(input.lines.map((l) => l.saleLineId)).size)
      throw new DomainError('INVALID', 'A returned line does not belong to this invoice');
    const already = tx.all<{ sale_line_id: string; q: number }>(
      sql`SELECT rl.sale_line_id, SUM(rl.qty_base) AS q FROM sale_return_lines rl JOIN sale_returns r ON r.id = rl.return_id WHERE r.sale_id = ${sale.id} GROUP BY rl.sale_line_id`,
    );

    const now = isoNow(ctx);
    const returnId = newId();
    const docNo = nextDocNo(tx, ctx, 'RET');
    const linePayload: (typeof saleReturnLines.$inferInsert)[] = [];
    const movements: PostedMovement[] = [];
    let refund = 0;

    for (const req of input.lines) {
      const line = lines.find((l) => l.id === req.saleLineId) as (typeof lines)[number];
      if (!Number.isInteger(req.qtyBase) || req.qtyBase <= 0)
        throw new DomainError('INVALID', 'Return quantity must be a whole number above zero');
      const done = Number(already.find((a) => a.sale_line_id === line.id)?.q ?? 0);
      if (req.qtyBase + done > line.qtyBase)
        throw new DomainError(
          'INVALID',
          `Only ${line.qtyBase - done} of this line can still be returned`,
        );
      // Refund what the customer actually paid for these units (after discount, with tax), rounded once.
      const lineRefund = proportionMinor(line.netMinor, req.qtyBase, line.qtyBase);
      refund += lineRefund;

      // Units go back to the batches they were sold from, in the order they were taken.
      const allocs = tx
        .select()
        .from(saleLineAllocations)
        .where(eq(saleLineAllocations.saleLineId, line.id))
        .all();
      const returnedBefore = done;
      let skip = returnedBefore;
      let left = req.qtyBase;
      for (const a of allocs) {
        if (left === 0) break;
        const available = a.qtyBase - Math.min(skip, a.qtyBase);
        skip = Math.max(0, skip - a.qtyBase);
        const take = Math.min(available, left);
        if (take <= 0) continue;
        left -= take;
        const lineRowId = newId();
        linePayload.push({
          id: lineRowId,
          returnId,
          saleLineId: line.id,
          itemId: line.itemId,
          batchId: a.batchId,
          qtyBase: take,
          refundMinor: proportionMinor(lineRefund, take, req.qtyBase),
          restock: req.restock,
        });
        if (req.restock) {
          movements.push(
            postMovement(tx, ctx, {
              itemId: line.itemId,
              batchId: a.batchId,
              kind: 'sale_return',
              qtyBase: take,
              unitCostMicro: a.costUnitMicro,
              docType: 'sale_return',
              docId: returnId,
              docLineId: lineRowId,
            }),
          );
        }
      }
    }

    // Refund limit per role: above it a manager PIN is needed.
    const limits = roleLimitsFor(tx, userId);
    if (limits.refundMinor !== null && refund > limits.refundMinor) {
      if (!input.overrideId)
        throw new DomainError(
          'OVERRIDE_REQUIRED',
          'This refund is above your limit. A manager must approve it',
          { kind: 'refund', amountMinor: refund },
        );
      consumeOverride(tx, ctx, {
        overrideId: input.overrideId,
        kind: 'refund',
        requesterId: userId,
        reference: `return:${returnId}`,
        amountMinor: refund,
      });
    }

    const header = {
      id: returnId,
      tenantId: ctx.tenantId,
      branchId: ctx.branchId,
      docNo,
      saleId: sale.id,
      shiftId: shift.id,
      reasonCode: input.reasonCode,
      reasonText: input.reasonText?.trim() ?? null,
      refundMinor: refund,
      refundModeId: mode.id,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
      hlc: ctx.clock.tick(),
      version: 1,
    };
    tx.insert(saleReturns).values(header).run();
    tx.insert(saleReturnLines).values(linePayload).run();
    recordChange(tx, ctx, {
      entityType: 'sale_returns',
      entityId: returnId,
      op: 'insert',
      payload: { ...header, lines: linePayload, movements },
    });
    appendAudit(tx, ctx, {
      action: 'sale.return',
      entityType: 'sale_return',
      entityId: returnId,
      newValue: { docNo, saleId: sale.id, refundMinor: refund, reason: input.reasonCode },
    });
    return { id: returnId, docNo, refundMinor: refund };
  });
}

// ------------------------------------------------------------------------------------------------
// Hold invoices and missed sales
// ------------------------------------------------------------------------------------------------

export interface HoldRow {
  id: string;
  label: string | null;
  createdBy: string;
  createdAt: string;
  version: number;
}

/** Park a cart on the server so any counter of the branch can resume it. */
export function holdInvoice(
  db: Db,
  ctx: WriteContext,
  input: { label?: string; payload: unknown; id?: string },
): string {
  if (!ctx.userId) throw new DomainError('INVALID', 'Sign in first');
  const userId = ctx.userId;
  const payloadJson = JSON.stringify(input.payload);
  if (payloadJson.length > 200_000)
    throw new DomainError('INVALID', 'This cart is too large to hold');
  return db.transaction((tx) => {
    const now = isoNow(ctx);
    if (input.id) {
      const existing = tx
        .select()
        .from(holdInvoices)
        .where(and(eq(holdInvoices.id, input.id), eq(holdInvoices.branchId, ctx.branchId)))
        .get();
      if (!existing) throw new DomainError('NOT_FOUND', 'Held invoice not found');
      tx.update(holdInvoices)
        .set({
          label: input.label ?? existing.label,
          payloadJson,
          version: existing.version + 1,
          updatedAt: now,
          hlc: ctx.clock.tick(),
        })
        .where(eq(holdInvoices.id, existing.id))
        .run();
      return existing.id;
    }
    const id = newId();
    tx.insert(holdInvoices)
      .values({
        id,
        tenantId: ctx.tenantId,
        branchId: ctx.branchId,
        createdBy: userId,
        label: input.label ?? null,
        payloadJson,
        createdAt: now,
        updatedAt: now,
        hlc: ctx.clock.tick(),
        version: 1,
      })
      .run();
    return id;
  });
}

export function listHolds(db: DbOrTx, branchId: string): HoldRow[] {
  return db
    .select()
    .from(holdInvoices)
    .where(eq(holdInvoices.branchId, branchId))
    .orderBy(desc(holdInvoices.createdAt))
    .all()
    .map((h) => ({
      id: h.id,
      label: h.label,
      createdBy: h.createdBy,
      createdAt: h.createdAt,
      version: h.version,
    }));
}

export function getHold(
  db: DbOrTx,
  branchId: string,
  id: string,
): { id: string; label: string | null; payload: unknown } {
  const h = db
    .select()
    .from(holdInvoices)
    .where(and(eq(holdInvoices.id, id), eq(holdInvoices.branchId, branchId)))
    .get();
  if (!h) throw new DomainError('NOT_FOUND', 'Held invoice not found');
  return { id: h.id, label: h.label, payload: JSON.parse(h.payloadJson) as unknown };
}

export function deleteHold(db: Db, ctx: WriteContext, id: string): void {
  db.transaction((tx) => {
    const h = tx
      .select()
      .from(holdInvoices)
      .where(and(eq(holdInvoices.id, id), eq(holdInvoices.branchId, ctx.branchId)))
      .get();
    if (!h) throw new DomainError('NOT_FOUND', 'Held invoice not found');
    tx.delete(holdInvoices).where(eq(holdInvoices.id, id)).run();
    appendAudit(tx, ctx, {
      action: 'hold.delete',
      entityType: 'hold_invoice',
      entityId: id,
      oldValue: { label: h.label },
    });
  });
}

export interface MissedSaleInput {
  itemId?: string | null;
  itemText?: string;
  unitId?: string | null;
  qty: number;
  customerPhone?: string;
  supplierId?: string | null;
}

/** Record something a customer wanted that was not available. Feeds low-stock and purchase suggestions. */
export function recordMissedSale(db: Db, ctx: WriteContext, input: MissedSaleInput): string {
  if (!input.itemId && !input.itemText?.trim())
    throw new DomainError('INVALID', 'Say which item was asked for');
  if (!Number.isInteger(input.qty) || input.qty <= 0)
    throw new DomainError('INVALID', 'Quantity must be a whole number above zero');
  return db.transaction((tx) => {
    const id = newId();
    const now = isoNow(ctx);
    const row = {
      id,
      tenantId: ctx.tenantId,
      branchId: ctx.branchId,
      itemId: input.itemId ?? null,
      itemText: input.itemText?.trim() ?? null,
      unitId: input.unitId ?? null,
      qty: input.qty,
      customerPhone: input.customerPhone?.trim() ?? null,
      supplierId: input.supplierId ?? null,
      createdBy: ctx.userId,
      createdAt: now,
      updatedAt: now,
      hlc: ctx.clock.tick(),
      version: 1,
    };
    tx.insert(missedSales).values(row).run();
    recordChange(tx, ctx, { entityType: 'missed_sales', entityId: id, op: 'insert', payload: row });
    return id;
  });
}

export interface TodaySummary {
  salesCount: number;
  revenueMinor: number;
  costMinor: number;
  grossProfitMinor: number;
  discountMinor: number;
  voidCount: number;
}

/** Numbers for the dashboard cards over a time range (posted sales only; voids counted separately). */
export function salesSummary(
  db: DbOrTx,
  branchId: string,
  fromIso: string,
  toIso: string,
): TodaySummary {
  const r = db.get<{ n: number; rev: number; cost: number; disc: number; tax: number }>(sql`
    SELECT COUNT(*) AS n, COALESCE(SUM(grand_total_minor), 0) AS rev, COALESCE(SUM(cost_minor), 0) AS cost,
           COALESCE(SUM(discount_minor), 0) AS disc, COALESCE(SUM(tax_minor), 0) AS tax
    FROM sales WHERE branch_id = ${branchId} AND status = 'posted' AND created_at >= ${fromIso} AND created_at <= ${toIso}`);
  const v = db.get<{ n: number }>(
    sql`SELECT COUNT(*) AS n FROM sales WHERE branch_id = ${branchId} AND status = 'void' AND created_at >= ${fromIso} AND created_at <= ${toIso}`,
  );
  const revenue = Number(r?.rev ?? 0);
  const cost = Number(r?.cost ?? 0);
  return {
    salesCount: Number(r?.n ?? 0),
    revenueMinor: revenue,
    costMinor: cost,
    grossProfitMinor: revenue - Number(r?.tax ?? 0) - cost,
    discountMinor: Number(r?.disc ?? 0),
    voidCount: Number(v?.n ?? 0),
  };
}
