import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DomainError } from './errors';
import {
  allBranchSettings,
  getSetting,
  SETTING_DEFAULTS,
  setSetting,
  setSettings,
} from './settings';
import { syncOutbox } from './schema/sqlite-all';
import { createTestEnv, type TestEnv } from './test-helpers';

let env: TestEnv;
const ctx = () => env.ctx(env.setup.adminUserId);

beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(() => env.cleanup());

describe('branch settings', () => {
  it('returns the defaults until something is saved (rupee rounding, 80 mm, drawer on cash)', () => {
    const s = allBranchSettings(env.db, ctx());
    expect(s).toEqual(SETTING_DEFAULTS);
    expect(s['pos.rounding']).toBe('rupee');
    expect(s['print.paper_width']).toBe('80');
    expect(s['print.open_drawer_on_cash']).toBe(true);
    expect(s['tax.default_sales_tax_bp']).toBe(0);
  });

  it('saves typed values, keeps them, and records audit and sync events', () => {
    const before = env.db.select().from(syncOutbox).all().length;
    setSettings(env.db, ctx(), {
      'print.copies': 2,
      'print.auto_print': true,
      'tax.default_wht_bp': 450,
      'print.printer_name': 'Receipt-1',
    });
    expect(getSetting(env.db, ctx(), 'print.copies')).toBe(2);
    expect(getSetting(env.db, ctx(), 'print.auto_print')).toBe(true);
    expect(getSetting(env.db, ctx(), 'tax.default_wht_bp')).toBe(450);
    expect(env.db.select().from(syncOutbox).all().length).toBe(before + 4);
    // Saving the same values again writes nothing.
    setSettings(env.db, ctx(), { 'print.copies': 2 });
    expect(env.db.select().from(syncOutbox).all().length).toBe(before + 4);
  });

  it('is all-or-nothing: one invalid value saves none of the request', () => {
    expect(() =>
      setSettings(env.db, ctx(), { 'print.auto_print': true, 'print.copies': 9 }),
    ).toThrow(DomainError);
    expect(getSetting(env.db, ctx(), 'print.auto_print')).toBe(false);
  });

  it('refuses unknown keys and wrong types', () => {
    expect(() => setSettings(env.db, ctx(), { 'made.up': 1 })).toThrow(/Unknown setting/);
    expect(() => setSetting(env.db, ctx(), 'print.auto_print', 'yes')).toThrow(DomainError);
    expect(() => setSetting(env.db, ctx(), 'print.paper_width', '100')).toThrow(DomainError);
    expect(() => setSetting(env.db, ctx(), 'tax.default_sales_tax_bp', 10_001)).toThrow(
      DomainError,
    );
    expect(() => setSetting(env.db, ctx(), 'tax.default_sales_tax_bp', 1.5)).toThrow(DomainError);
    expect(() => setSetting(env.db, ctx(), 'pos.rounding', 'banana')).toThrow(DomainError);
  });
});
