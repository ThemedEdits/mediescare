import { and, eq } from 'drizzle-orm';
import type { Rounding } from '@mediescare/core';
import { newId } from '@mediescare/sync';
import { appendAudit } from './audit';
import type { Db, DbOrTx } from './client';
import { isoNow, type WriteContext } from './context';
import { DomainError } from './errors';
import { recordChange } from './outbox';
import { settings } from './schema/sqlite-all';

/** Branch settings the application understands, with their defaults (nothing hard-coded elsewhere). */
export const SETTING_DEFAULTS = {
  /** Bill total rounding at the counter. Owner decision: nearest whole rupee. */
  'pos.rounding': 'rupee' as Rounding,
  /** Default note printed on invoices. */
  'pos.invoice_note': '',
  /** Windows printer name for receipts. Empty means the system default printer. */
  'print.printer_name': '',
  /** Receipt paper width in millimetres. */
  'print.paper_width': '80' as '58' | '80',
  /** Print the receipt as soon as a sale is saved. */
  'print.auto_print': false,
  /** Kick the cash drawer (RJ11 through the printer) when a sale takes cash. */
  'print.open_drawer_on_cash': true,
  /** Drawer connector on the printer: pin 2 (most drawers) or pin 5. */
  'print.drawer_pin': 'pin2' as 'pin2' | 'pin5',
  /** Number of receipt copies. */
  'print.copies': 1,
  /** Lines printed above and below the receipt (shop name lines, thank-you text). */
  'print.receipt_header': '',
  'print.receipt_footer': '',
  /** Default tax rates in basis points (100 = 1%), used to pre-fill forms. Owner sets them; none are assumed. */
  'tax.default_sales_tax_bp': 0,
  'tax.default_advance_tax_bp': 0,
  'tax.default_wht_bp': 0,
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;
export type SettingValue = string | number | boolean;
export type BranchSettings = { [K in SettingKey]: (typeof SETTING_DEFAULTS)[K] };

const bad = (message: string): never => {
  throw new DomainError('INVALID', message);
};
const text = (value: unknown, max: number, label: string): void => {
  if (typeof value !== 'string' || value.length > max)
    bad(`${label} must be text of at most ${max} characters`);
};
const oneOf = (value: unknown, allowed: readonly string[], label: string): void => {
  if (typeof value !== 'string' || !allowed.includes(value))
    bad(`${label} must be one of: ${allowed.join(', ')}`);
};
const bool = (value: unknown, label: string): void => {
  if (typeof value !== 'boolean') bad(`${label} must be on or off`);
};
const intRange = (value: unknown, min: number, max: number, label: string): void => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
    bad(`${label} must be a whole number from ${min} to ${max}`);
};

const VALIDATORS: { [K in SettingKey]: (value: unknown) => void } = {
  'pos.rounding': (v) => oneOf(v, ['none', 'rupee', 'half_rupee'], 'Rounding'),
  'pos.invoice_note': (v) => text(v, 500, 'The invoice note'),
  'print.printer_name': (v) => text(v, 200, 'The printer name'),
  'print.paper_width': (v) => oneOf(v, ['58', '80'], 'Paper width'),
  'print.auto_print': (v) => bool(v, 'Auto print'),
  'print.open_drawer_on_cash': (v) => bool(v, 'Open drawer on cash'),
  'print.drawer_pin': (v) => oneOf(v, ['pin2', 'pin5'], 'Drawer connector'),
  'print.copies': (v) => intRange(v, 1, 3, 'Copies'),
  'print.receipt_header': (v) => text(v, 300, 'The receipt header'),
  'print.receipt_footer': (v) => text(v, 300, 'The receipt footer'),
  'tax.default_sales_tax_bp': (v) => intRange(v, 0, 10_000, 'Sales tax rate'),
  'tax.default_advance_tax_bp': (v) => intRange(v, 0, 10_000, 'Advance tax rate'),
  'tax.default_wht_bp': (v) => intRange(v, 0, 10_000, 'Withholding tax rate'),
};

export const SETTING_KEYS = Object.keys(SETTING_DEFAULTS) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return key in SETTING_DEFAULTS;
}

export function getSetting<K extends SettingKey>(
  db: DbOrTx,
  ctx: WriteContext,
  key: K,
): (typeof SETTING_DEFAULTS)[K] {
  const row = db
    .select({ value: settings.valueJson })
    .from(settings)
    .where(
      and(
        eq(settings.tenantId, ctx.tenantId),
        eq(settings.scope, 'branch'),
        eq(settings.scopeId, ctx.branchId),
        eq(settings.key, key),
      ),
    )
    .get();
  return row ? (JSON.parse(row.value) as (typeof SETTING_DEFAULTS)[K]) : SETTING_DEFAULTS[key];
}

export const getPosRounding = (db: DbOrTx, ctx: WriteContext): Rounding =>
  getSetting(db, ctx, 'pos.rounding');

function writeSetting(tx: DbOrTx, ctx: WriteContext, key: SettingKey, value: SettingValue): void {
  VALIDATORS[key](value);
  const now = isoNow(ctx);
  const existing = tx
    .select()
    .from(settings)
    .where(
      and(
        eq(settings.tenantId, ctx.tenantId),
        eq(settings.scope, 'branch'),
        eq(settings.scopeId, ctx.branchId),
        eq(settings.key, key),
      ),
    )
    .get();
  const before = existing ? (JSON.parse(existing.valueJson) as unknown) : SETTING_DEFAULTS[key];
  if (JSON.stringify(before) === JSON.stringify(value)) return;
  if (existing) {
    tx.update(settings)
      .set({
        valueJson: JSON.stringify(value),
        version: existing.version + 1,
        updatedAt: now,
        hlc: ctx.clock.tick(),
      })
      .where(eq(settings.id, existing.id))
      .run();
  } else {
    tx.insert(settings)
      .values({
        id: newId(),
        tenantId: ctx.tenantId,
        scope: 'branch',
        scopeId: ctx.branchId,
        key,
        valueJson: JSON.stringify(value),
        createdAt: now,
        updatedAt: now,
        hlc: ctx.clock.tick(),
        version: 1,
      })
      .run();
  }
  recordChange(tx, ctx, {
    entityType: 'settings',
    entityId: `${ctx.branchId}:${key}`,
    op: existing ? 'update' : 'insert',
    payload: { scope: 'branch', scopeId: ctx.branchId, key, value },
  });
  appendAudit(tx, ctx, {
    action: 'settings.update',
    entityType: 'setting',
    entityId: key,
    oldValue: { value: before },
    newValue: { value },
  });
}

export function setSetting(db: Db, ctx: WriteContext, key: SettingKey, value: SettingValue): void {
  db.transaction((tx) => writeSetting(tx, ctx, key, value));
}

/** Save several settings together: all are valid and saved, or none are. Unknown keys are refused. */
export function setSettings(
  db: Db,
  ctx: WriteContext,
  values: Partial<Record<string, SettingValue>>,
): void {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined) as [
    string,
    SettingValue,
  ][];
  for (const [key] of entries) if (!isSettingKey(key)) bad(`Unknown setting: ${key}`);
  db.transaction((tx) => {
    for (const [key, value] of entries) writeSetting(tx, ctx, key as SettingKey, value);
  });
}

export function allBranchSettings(db: DbOrTx, ctx: WriteContext): BranchSettings {
  return Object.fromEntries(SETTING_KEYS.map((k) => [k, getSetting(db, ctx, k)])) as BranchSettings;
}
