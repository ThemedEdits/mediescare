/**
 * Demo data for development. Every name below is invented. Never seed real customers or staff
 * (CLAUDE.md §1, owner decision 7). Phase 1 seeds identity data only. Items and stock come in Phase 2.
 */
import { openDatabase } from '../client';
import { hashPassword } from '../auth/password';
import { AlreadyInitializedError, runFirstRunSetup } from '../firstRun';
import { runMigrations } from '../migrate';
import { cliDatabaseOptions } from './env';

const { db, close } = openDatabase(cliDatabaseOptions());
try {
  runMigrations(db);
  const demoPassword = process.env.MEDIESCARE_DEMO_PASSWORD ?? 'demo-Password-2026';
  const result = runFirstRunSetup(db, {
    tenantName: 'Demo Pharmacy Group',
    branchCode: 'HO01',
    branchName: 'Demo Head Office',
    isHeadOffice: true,
    deviceName: 'Demo Server',
    admin: { username: 'admin', fullName: 'Demo Admin', passwordHash: await hashPassword(demoPassword) },
  });
  console.log(`Seeded demo tenant. Branch ${result.branchId}. Login: admin / ${demoPassword}`);
} catch (error) {
  if (error instanceof AlreadyInitializedError) console.log('Database already seeded. Nothing to do.');
  else throw error;
} finally {
  close();
}
