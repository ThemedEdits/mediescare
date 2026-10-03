import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: [
    './src/schema/pg.ts',
    './src/schema/pg-pharmacy.ts',
    './src/schema/pg-compliance.ts',
    './src/schema/pg-purchasing.ts',
    './src/schema/pg-inventory.ts',
    './src/schema/pg-sync.ts',
    './src/schema/pg-transfers.ts',
    './src/schema/pg-accounts.ts',
  ],
  out: './migrations/pg',
});
