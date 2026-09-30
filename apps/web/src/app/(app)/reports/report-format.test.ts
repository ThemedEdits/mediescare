import { describe, expect, it } from 'vitest';
import { compareCells, formatCell, presetRange, reportQuery, sortRows } from './report-format';

describe('report formatting', () => {
  it('computes presets from the local calendar, weeks start on Monday', () => {
    const wed = new Date(2026, 9, 7, 23, 30); // Wed 7 Oct 2026, late evening
    expect(presetRange('today', wed)).toEqual({ from: '2026-10-07', to: '2026-10-07' });
    expect(presetRange('yesterday', wed)).toEqual({ from: '2026-10-06', to: '2026-10-06' });
    expect(presetRange('week', wed)).toEqual({ from: '2026-10-05', to: '2026-10-07' });
    expect(presetRange('month', wed)).toEqual({ from: '2026-10-01', to: '2026-10-07' });
    expect(presetRange('last30', wed)).toEqual({ from: '2026-09-08', to: '2026-10-07' });
    const sun = new Date(2026, 9, 11);
    expect(presetRange('week', sun).from).toBe('2026-10-05');
  });

  it('formats money with separators and 2 decimals, percent and quantities', () => {
    expect(formatCell('money', 123_456_789)).toBe('1,234,567.89');
    expect(formatCell('money', 5)).toBe('0.05');
    expect(formatCell('percent', 25.5)).toBe('25.50%');
    expect(formatCell('qty', 1_500)).toBe('1,500');
    expect(formatCell('text', null)).toBe('');
    expect(formatCell('date', '2026-10-05')).toBe('2026-10-05');
  });

  it('sorts numbers as numbers and keeps empty cells last', () => {
    expect(compareCells(9, 10)).toBeLessThan(0);
    const rows = [{ a: 10 }, { a: null }, { a: 9 }];
    expect(sortRows(rows, 'a', 'asc').map((r) => r.a)).toEqual([9, 10, null]);
    expect(sortRows(rows, 'a', 'desc').map((r) => r.a)).toEqual([10, 9, null]);
    expect(sortRows(rows, null, 'asc')).toBe(rows);
  });

  it('builds the query only with the filters a report supports', () => {
    const f = { from: '2026-10-01', to: '2026-10-07', q: ' para ', bucket: 'expired', limit: '50' };
    expect(reportQuery(f, ['range', 'q'])).toBe('from=2026-10-01&to=2026-10-07&q=para');
    expect(reportQuery(f, ['bucket', 'limit'])).toBe('bucket=expired&limit=50');
    expect(reportQuery(f, [])).toBe('');
  });
});
