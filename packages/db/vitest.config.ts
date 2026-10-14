import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    pool: 'forks',
    testTimeout: 30_000,
    // Setup builds several databases (argon2, migrations): slow shared CI runners need more than 10 s.
    hookTimeout: 60_000,
  },
});
