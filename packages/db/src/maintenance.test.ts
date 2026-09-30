import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { refreshStatistics, statisticsTableCount } from './maintenance';
import { createTestEnv, type TestEnv } from './test-helpers';

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(() => env.cleanup());

describe('query statistics', () => {
  it('are created by the refresh and can be refreshed again', () => {
    expect(statisticsTableCount(env.db)).toBe(0);
    refreshStatistics(env.db);
    expect(statisticsTableCount(env.db)).toBeGreaterThan(5);
    expect(() => refreshStatistics(env.db)).not.toThrow();
  });
});
