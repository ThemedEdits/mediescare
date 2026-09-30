import type { Translator } from '@/i18n/core';
import type { Column } from './report-format';

/** Use the translation when it exists, otherwise the server's English text. */
function pick(t: Translator, keys: string[], fallback: string): string {
  for (const k of keys) if (t.has(k)) return t(k);
  return fallback;
}

export const reportTitle = (t: Translator, id: string, fallback: string) =>
  pick(t, [`reports.titles.${id}`], fallback);

/** Heading above the open report (a few reports have a longer heading than their menu name). */
export const reportHeading = (t: Translator, id: string, fallback: string) =>
  pick(t, [`reports.headings.${id}`, `reports.titles.${id}`], fallback);

export const reportColumn = (t: Translator, reportId: string, c: Column) =>
  pick(t, [`reports.columns.${reportId}.${c.key}`, `reports.col.${c.key}`], c.label);

export const reportNote = (t: Translator, id: string, note: string) => {
  // The low stock note carries the date range the server used.
  const range = /from (\S+) to (\S+) \(/.exec(note);
  if (id === 'low-stock' && range && t.has('reports.notes.low-stock'))
    return t('reports.notes.low-stock', { from: range[1] ?? '', to: range[2] ?? '' });
  return pick(t, [`reports.notes.${id}`], note);
};

const camel = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+(.)?/g, (_m, c: string | undefined) => (c ? c.toUpperCase() : ''));

export const kpiLabel = (t: Translator, label: string) =>
  pick(t, [`reports.kpi.${camel(label)}`], label);

export const BUCKET_KEYS: Record<string, string> = {
  '': 'all',
  expired: 'expired',
  '0-30': 'b0_30',
  '31-60': 'b31_60',
  '61-90': 'b61_90',
  '91-180': 'b91_180',
};

const BUCKET_TEXT: Record<string, string> = {
  Expired: 'expired',
  '0-30 days': 'b0_30',
  '31-60 days': 'b31_60',
  '61-90 days': 'b61_90',
  '91-180 days': 'b91_180',
};

/** Fixed words the server puts in cells (status, bucket, payment kind, walk-in customer). */
export function reportCellText(t: Translator, columnKey: string, text: string): string {
  if (columnKey === 'status') {
    if (text === 'Void') return pick(t, ['reports.cell.void'], text);
    if (text === 'Posted') return pick(t, ['reports.cell.posted'], text);
  } else if (columnKey === 'customer' && text === 'Walk-in') {
    return pick(t, ['reports.cell.walkIn'], text);
  } else if (columnKey === 'bucket' && BUCKET_TEXT[text]) {
    return pick(t, [`reports.bucket.${BUCKET_TEXT[text]}`], text);
  } else if (columnKey === 'kind') {
    return pick(t, [`reports.kind.${text}`], text);
  }
  return text;
}
