import { defineConfig } from '@playwright/test';

// End-to-end tests drive the PACKAGED Windows app (release/win-unpacked) through its real window.
// Build it first: pnpm --filter @mediescare/desktop package:dir
export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list']],
  use: { trace: 'off' },
});
