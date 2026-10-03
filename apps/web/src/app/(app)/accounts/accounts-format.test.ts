import { describe, expect, it } from 'vitest';
import { expenseQuery, pageCount, parseExpenseAmount } from './accounts-format';

const base = {
  from: '2026-10-01',
  to: '2026-10-31',
  categoryId: '',
  modeId: '',
  status: '' as const,
  page: 1,
};

describe('expense helpers', () => {
  it('leaves empty filters out of the query', () => {
    expect(expenseQuery(base, 50)).toBe('from=2026-10-01&to=2026-10-31&pageSize=50');
    const q = new URLSearchParams(
      expenseQuery({ ...base, categoryId: 'c1', modeId: 'm1', status: 'void', page: 3 }, 25),
    );
    expect(Object.fromEntries(q)).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
      pageSize: '25',
      categoryId: 'c1',
      modeId: 'm1',
      status: 'void',
      page: '3',
    });
  });

  it('turns typed amounts into integer paisa and refuses zero, negative and junk', () => {
    expect(parseExpenseAmount('1,250.50')).toBe(125_050);
    expect(parseExpenseAmount('30')).toBe(3_000);
    expect(parseExpenseAmount('0')).toBeNull();
    expect(parseExpenseAmount('-5')).toBeNull();
    expect(parseExpenseAmount('abc')).toBeNull();
    expect(parseExpenseAmount('')).toBeNull();
  });

  it('counts pages', () => {
    expect(pageCount(0, 50)).toBe(1);
    expect(pageCount(50, 50)).toBe(1);
    expect(pageCount(51, 50)).toBe(2);
  });
});
