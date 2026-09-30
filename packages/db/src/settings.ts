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
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

const ROUNDING_VALUES: readonly string[] = ['none', 'rupee', 'half_rupee'];

function validate(key: SettingKey, value: unknown): void {
  if (key === 'pos.rounding' && !(typeof value === 'string' && ROUNDING_VALUES.includes(value))) {
    throw new DomainError('INVALID', 'Rounding must be none, rupee or half_rupee');
  }
  if (key === 'pos.invoice_note' && (typeof value !== 'string' || value.length > 500)) {
    throw new DomainError('INVALID', 'The invoice note must be text of at most 500 characters');
  }
}

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

export function setSetting(db: Db, ctx: WriteContext, key: SettingKey, value: string): void {
  validate(key, value);
  db.transaction((tx) => {
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
      const row = {
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
      };
      tx.insert(settings).values(row).run();
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
  });
}

export function allBranchSettings(
  db: DbOrTx,
  ctx: WriteContext,
): { [K in SettingKey]: (typeof SETTING_DEFAULTS)[K] } {
  return {
    'pos.rounding': getSetting(db, ctx, 'pos.rounding'),
    'pos.invoice_note': getSetting(db, ctx, 'pos.invoice_note'),
  };
}
