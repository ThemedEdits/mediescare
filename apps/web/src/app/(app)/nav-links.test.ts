import { describe, expect, it } from 'vitest';
import { isActivePath } from './nav-links';

describe('isActivePath', () => {
  it('marks the open page and its sub-pages', () => {
    expect(isActivePath('/items', '/items')).toBe(true);
    expect(isActivePath('/items/import', '/items')).toBe(true);
    expect(isActivePath('/items', '/pos')).toBe(false);
  });

  it('marks the dashboard only on the dashboard itself', () => {
    expect(isActivePath('/', '/')).toBe(true);
    expect(isActivePath('/pos', '/')).toBe(false);
  });

  it('does not confuse pages that share a prefix', () => {
    expect(isActivePath('/stock-take', '/stock')).toBe(false);
    expect(isActivePath('/stock-take', '/stock-take')).toBe(true);
  });
});
