import { describe, expect, it } from 'vitest';
import { qty } from './types';

const units = [
  { name: 'Box', factorToBase: 100 },
  { name: 'Strip', factorToBase: 10 },
  { name: 'Tablet', factorToBase: 1 },
];

describe('transfer quantity display', () => {
  it('shows the smallest-unit quantity in the item units', () => {
    expect(qty(235, units)).toBe('2 Box + 3 Strip + 5 Tablet');
    expect(qty(100, units)).toBe('1 Box');
  });
  it('falls back to the plain number when there are no units or no quantity', () => {
    expect(qty(0, units)).toBe('0');
    expect(qty(7, [])).toBe('7');
  });
});
