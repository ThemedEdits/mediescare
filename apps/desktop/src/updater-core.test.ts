import { describe, expect, it } from 'vitest';
import { updatesEnabled } from './updater-core';

describe('updatesEnabled', () => {
  it('runs only in the installed app', () => {
    expect(updatesEnabled({ isPackaged: true, env: {} })).toBe(true);
    expect(updatesEnabled({ isPackaged: false, env: {} })).toBe(false);
  });

  it('can be switched off for tests', () => {
    expect(updatesEnabled({ isPackaged: true, env: { MEDIESCARE_DISABLE_UPDATES: '1' } })).toBe(
      false,
    );
  });
});
