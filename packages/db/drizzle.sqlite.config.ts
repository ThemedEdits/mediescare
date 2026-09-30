import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: [
    './src/schema/sqlite.ts',
    './src/schema/sqlite-pharmacy.ts',
    './src/schema/sqlite-compliance.ts',
  ],
  out: './migrations/sqlite',
});
