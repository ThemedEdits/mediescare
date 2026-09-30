import type { ReportResult, Sensitivity } from './types';

export type ColumnRights = Record<Sensitivity, boolean>;

/**
 * Remove every column, row value, total and KPI the user has no right to see. Done on the server before
 * anything is sent or exported, so cost and profit never leave it for a cashier or store keeper.
 */
export function applyColumnRights(result: ReportResult, rights: ColumnRights): ReportResult {
  const hidden = result.columns.filter((c) => c.sensitivity && !rights[c.sensitivity]);
  if (hidden.length === 0 && !result.kpis?.some((k) => k.sensitivity && !rights[k.sensitivity]))
    return result;
  const drop = new Set(hidden.map((c) => c.key));
  const omit = <T extends Record<string, unknown>>(obj: T): T =>
    Object.fromEntries(Object.entries(obj).filter(([k]) => !drop.has(k))) as T;
  return {
    ...result,
    columns: result.columns.filter((c) => !drop.has(c.key)),
    rows: result.rows.map(omit),
    totals: result.totals ? omit(result.totals) : undefined,
    kpis: result.kpis?.filter((k) => !k.sensitivity || rights[k.sensitivity]),
  };
}
