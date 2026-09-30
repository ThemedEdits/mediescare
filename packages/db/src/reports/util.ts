import { proportionMinor } from '@mediescare/core';
import { eq, sql, type SQL } from 'drizzle-orm';
import type { DbOrTx } from '../client';
import type { WriteContext } from '../context';
import { DomainError } from '../errors';
import { branches } from '../schema/sqlite-all';
import { branchToday, ftsQuery } from '../pharmacy/common';
import type { ReportCell, ReportFilters, ReportRow } from './types';

export const MAX_ROWS = 100_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ReportRange {
  from: string;
  to: string;
  /** Inclusive start and exclusive end as UTC ISO strings, comparable with `created_at`. */
  startIso: string;
  endIso: string;
  /** SQLite date modifier that turns a UTC timestamp into branch-local time, for example '+300 minutes'. */
  localMod: string;
  timezone: string;
}

function assertDate(value: string, label: string): void {
  const ok = DATE_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
  if (!ok || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)
    throw new DomainError('INVALID', `${label} must be a date like 2026-10-05`);
}

function offsetMinutes(timezone: string, atMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(atMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.trunc((asUtc - Math.floor(atMs / 1000) * 1000) / 60_000);
}

/** UTC instant of local midnight at the start of `date` in the time zone. */
function localMidnightUtc(date: string, timezone: string): number {
  const naive = Date.parse(`${date}T00:00:00Z`);
  const first = naive - offsetMinutes(timezone, naive) * 60_000;
  return naive - offsetMinutes(timezone, first) * 60_000;
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Turn the from/to dates (branch-local, inclusive) into UTC bounds. Without dates the range is today
 * (or the last `defaultDays` days ending today).
 */
export function resolveRange(
  db: DbOrTx,
  ctx: WriteContext,
  filters: ReportFilters,
  defaultDays = 1,
): ReportRange {
  const today = branchToday(db, ctx);
  const timezone =
    db.select({ tz: branches.timezone }).from(branches).where(eq(branches.id, ctx.branchId)).get()
      ?.tz ?? 'Asia/Karachi';
  const to = filters.to ?? today;
  const from = filters.from ?? (filters.to ? to : addDays(to, 1 - defaultDays));
  assertDate(from, 'From date');
  assertDate(to, 'To date');
  if (from > to) throw new DomainError('INVALID', 'From date is after the to date');
  const startMs = localMidnightUtc(from, timezone);
  const endMs = localMidnightUtc(addDays(to, 1), timezone);
  const mid = Math.floor((startMs + endMs) / 2);
  const off = offsetMinutes(timezone, mid);
  return {
    from,
    to,
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
    localMod: `${off >= 0 ? '+' : '-'}${Math.abs(off)} minutes`,
    timezone,
  };
}

export function clampLimit(limit: number | undefined, fallback: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return fallback;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_ROWS);
}

/** SQL fragment restricting alias.id to items matching the typed text (full-text index: words and prefixes). */
export function itemMatch(q: string | undefined, alias: string): SQL {
  const match = ftsQuery(q ?? '');
  return match
    ? sql`AND ${sql.raw(alias)}.id IN (SELECT item_id FROM items_fts WHERE items_fts MATCH ${match})`
    : sql``;
}

export function likePattern(q: string | undefined): string | null {
  const t = (q ?? '').trim().toLowerCase();
  return t ? `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
}

export const num = (v: unknown): number => Number(v ?? 0);

/** Percent with two decimals from integer parts, without float drift: 1234/5000 -> 24.68. */
export function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return proportionMinor(part, 10_000, whole) / 100;
}

export function sumRows(rows: ReportRow[], keys: string[]): Record<string, ReportCell> {
  const totals: Record<string, ReportCell> = {};
  for (const key of keys) totals[key] = rows.reduce((s, r) => s + num(r[key]), 0);
  return totals;
}

/** Rows fetched with LIMIT cap+1: drop the extra row and report whether the list was cut. */
export function cut<T>(rows: T[], cap: number): { rows: T[]; truncated: boolean } {
  return rows.length > cap
    ? { rows: rows.slice(0, cap), truncated: true }
    : { rows, truncated: false };
}
