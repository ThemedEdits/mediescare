import { join, resolve } from 'node:path';

/** Resolve the local database location and key for CLI tools. Development only. */
export function cliDatabaseOptions(): { file: string; keyHex: string } {
  const dataDir = resolve(process.env.MEDIESCARE_DATA_DIR ?? './data');
  const keyHex = process.env.MEDIESCARE_DB_KEY ?? '';
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error(
      'Set MEDIESCARE_DB_KEY to 64 hex characters for local development (see .env.example). ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  return { file: join(dataDir, 'mediescare.db'), keyHex };
}
