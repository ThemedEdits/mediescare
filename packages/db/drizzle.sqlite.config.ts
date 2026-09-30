import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: [
    './src/schema/sqlite.ts',
    './src/schema/sqlite-pharmacy.ts',
    './src/schema/sqlite-compliance.ts',
    './src/schema/sqlite-purchasing.ts',
    './src/schema/sqlite-inventory.ts',
    './src/schema/sqlite-sync.ts',
    './src/schema/sqlite-transfers.ts',
  ],
  out: './migrations/sqlite',
});
