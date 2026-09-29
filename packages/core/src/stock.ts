/**
 * Batch, expiry and unit logic for stock (CLAUDE.md §6). Pure functions: no I/O.
 * Dates are calendar days as 'YYYY-MM-DD' (batch expiry has no time of day).
 */

export class StockError extends Error {
  constructor(
    public readonly code:
      'EXPIRED_BATCH' | 'BLOCKED_BATCH' | 'INSUFFICIENT_STOCK' | 'UNKNOWN_BATCH',
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'StockError';
  }
}

const DAY_MS = 86_400_000;

function dayNumber(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new SyntaxError(`Invalid date "${date}", expected YYYY-MM-DD`);
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS);
}

/** Whole days from `today` to `expiry`. Negative when already expired. Expiry day itself is 0 (still sellable). */
export function daysUntil(expiry: string, today: string): number {
  return dayNumber(expiry) - dayNumber(today);
}

export type ExpiryState = 'expired' | 'near' | 'ok';

export interface ExpiryStatus {
  state: ExpiryState;
  daysLeft: number;
  /** The smallest configured window the batch falls in (for example 30), or null. */
  window: number | null;
}

/** Expired = the day after the printed expiry date. Near-expiry windows are configurable (default 30/60/90/180). */
export function expiryStatus(
  expiry: string,
  today: string,
  windows: readonly number[] = [30, 60, 90, 180],
): ExpiryStatus {
  const daysLeft = daysUntil(expiry, today);
  if (daysLeft < 0) return { state: 'expired', daysLeft, window: null };
  const window = [...windows].sort((a, b) => a - b).find((w) => daysLeft <= w) ?? null;
  return { state: window === null ? 'ok' : 'near', daysLeft, window };
}

export interface StockBatch {
  id: string;
  batchNo: string;
  /** 'YYYY-MM-DD' */
  expiryDate: string;
  /** Quantity on hand in the smallest unit. */
  available: number;
  costUnitMicro: number;
  /** Recalled or quarantined batches are never sold. */
  blocked?: boolean;
}

export interface Allocation {
  batchId: string;
  qty: number;
  costUnitMicro: number;
}

export interface AllocateOptions {
  /** Cashier picked a batch by hand. It is used first (still refused if expired or blocked). */
  preferredBatchId?: string;
  /**
   * Item or branch allows selling below zero. Any shortfall is put on this batch (normally the
   * batch with the latest expiry, or the newest one), so cost and the ledger stay traceable.
   */
  allowNegativeOnBatchId?: string;
}

export interface AllocationResult {
  allocations: Allocation[];
  /** Quantity that could not be covered (always 0 when the call succeeds). */
  shortfall: number;
}

const byExpiry = (a: StockBatch, b: StockBatch) =>
  a.expiryDate < b.expiryDate
    ? -1
    : a.expiryDate > b.expiryDate
      ? 1
      : a.batchNo.localeCompare(b.batchNo) || a.id.localeCompare(b.id);

/**
 * First-Expiry-First-Out allocation. Expired and blocked batches are skipped, never sold.
 * Throws INSUFFICIENT_STOCK when the eligible batches cannot cover the quantity
 * (unless negative stock is allowed for this line).
 */
export function allocateFefo(
  batches: readonly StockBatch[],
  qty: number,
  today: string,
  options: AllocateOptions = {},
): AllocationResult {
  if (!Number.isSafeInteger(qty) || qty <= 0)
    throw new RangeError('Quantity must be a positive whole number');

  const eligible = batches
    .filter((b) => !b.blocked && b.available > 0 && daysUntil(b.expiryDate, today) >= 0)
    .sort(byExpiry);

  const ordered: StockBatch[] = [];
  if (options.preferredBatchId) {
    const chosen = batches.find((b) => b.id === options.preferredBatchId);
    if (!chosen) throw new StockError('UNKNOWN_BATCH', 'The selected batch does not exist');
    if (chosen.blocked)
      throw new StockError(
        'BLOCKED_BATCH',
        `Batch ${chosen.batchNo} is blocked (recalled or in quarantine)`,
      );
    if (daysUntil(chosen.expiryDate, today) < 0)
      throw new StockError(
        'EXPIRED_BATCH',
        `Batch ${chosen.batchNo} is expired and cannot be sold`,
      );
    ordered.push(chosen, ...eligible.filter((b) => b.id !== chosen.id));
  } else {
    ordered.push(...eligible);
  }

  const allocations: Allocation[] = [];
  let remaining = qty;
  for (const batch of ordered) {
    if (remaining === 0) break;
    const take = Math.min(batch.available, remaining);
    if (take > 0) {
      allocations.push({ batchId: batch.id, qty: take, costUnitMicro: batch.costUnitMicro });
      remaining -= take;
    }
  }

  if (remaining > 0) {
    if (options.allowNegativeOnBatchId) {
      const fallback = batches.find((b) => b.id === options.allowNegativeOnBatchId);
      if (!fallback || fallback.blocked || daysUntil(fallback.expiryDate, today) < 0) {
        throw new StockError(
          'INSUFFICIENT_STOCK',
          'Not enough stock, and no valid batch to record the shortage against',
          { shortfall: remaining },
        );
      }
      const existing = allocations.find((a) => a.batchId === fallback.id);
      if (existing) existing.qty += remaining;
      else
        allocations.push({
          batchId: fallback.id,
          qty: remaining,
          costUnitMicro: fallback.costUnitMicro,
        });
      remaining = 0;
    } else {
      throw new StockError(
        'INSUFFICIENT_STOCK',
        `Only ${qty - remaining} available, ${qty} requested`,
        { available: qty - remaining, requested: qty, shortfall: remaining },
      );
    }
  }
  return { allocations, shortfall: remaining };
}

export interface UnitDef {
  id: string;
  name: string;
  /** How many smallest units are in one of this unit (tablet = 1, strip = 10, box = 100). */
  factorToBase: number;
}

/** Quantity typed in a selling unit, converted to the smallest unit stock is kept in. */
export function toBaseQty(qty: number, unit: Pick<UnitDef, 'factorToBase'>): number {
  if (!Number.isFinite(qty) || qty <= 0) throw new RangeError('Quantity must be positive');
  const raw = qty * unit.factorToBase;
  // Tolerate floating point noise from typing 0.1 x 30, but not real fractions of the smallest unit.
  const base = Math.floor(raw + 0.5);
  if (Math.abs(raw - base) > 1e-6 || !Number.isSafeInteger(base) || base <= 0) {
    throw new RangeError(
      'That quantity is not a whole number of the smallest unit (for example half a tablet)',
    );
  }
  return base;
}

/** "2 box + 3 strip + 4 tablet" for a base quantity, largest unit first. Zero parts are left out. */
export function formatMixedQty(baseQty: number, units: readonly UnitDef[]): string {
  if (baseQty === 0) return '0';
  const sorted = [...units].sort((a, b) => b.factorToBase - a.factorToBase);
  const sign = baseQty < 0 ? '-' : '';
  let rest = Math.abs(baseQty);
  const parts: string[] = [];
  for (const u of sorted) {
    const n = Math.floor(rest / u.factorToBase);
    if (n > 0) {
      parts.push(`${n} ${u.name}`);
      rest -= n * u.factorToBase;
    }
  }
  return sign + parts.join(' + ');
}

/** Stock is the sum of append-only ledger movements. Never an editable number (CLAUDE.md §4.3 rule 4). */
export function balanceFromMovements(movements: readonly { qtyBase: number }[]): number {
  return movements.reduce((sum, m) => sum + m.qtyBase, 0);
}

export const MOVEMENT_KINDS = [
  'opening',
  'purchase',
  'sale',
  'sale_return',
  'purchase_return',
  'transfer_out',
  'transfer_in',
  'adjustment',
  'expiry_writeoff',
  'consume',
] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

/** Kinds that take stock out: their quantity must be stored as a negative number. */
export const OUTBOUND_KINDS: ReadonlySet<MovementKind> = new Set([
  'sale',
  'purchase_return',
  'transfer_out',
  'expiry_writeoff',
  'consume',
]);
/** Kinds that always bring stock in. */
export const INBOUND_KINDS: ReadonlySet<MovementKind> = new Set([
  'opening',
  'purchase',
  'sale_return',
  'transfer_in',
]);

export function signedQty(kind: MovementKind, qtyBase: number): number {
  if (!Number.isSafeInteger(qtyBase) || qtyBase === 0)
    throw new RangeError('Movement quantity must be a non-zero whole number');
  const magnitude = Math.abs(qtyBase);
  if (OUTBOUND_KINDS.has(kind)) return -magnitude;
  if (INBOUND_KINDS.has(kind)) return magnitude;
  return qtyBase; // adjustment keeps its sign
}
