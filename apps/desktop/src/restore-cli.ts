/**
 * Restore tool. Runs on Electron's Node next to the web server's node_modules (so the native
 * database module resolves), with the server stopped. Reads one JSON request from stdin and
 * writes one JSON result to stdout. The recovery key travels over stdin, never argv.
 */
import { readManifest, restoreBackup, saveKeyring } from '@mediescare/db/backup';

interface Request {
  backupPath: string;
  targetDbFile: string;
  safetyDir: string;
  dataDir: string;
  dbKeyHex?: string;
  recoveryKey?: string;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  const req = JSON.parse(await readStdin()) as Request;
  try {
    const result = restoreBackup({
      backupPath: req.backupPath,
      targetDbFile: req.targetDbFile,
      safetyDir: req.safetyDir,
      dbKeyHex: req.dbKeyHex,
      recoveryKey: req.recoveryKey,
    });
    // Keep the same recovery key working for the restored data.
    const wrapped = readManifest(req.backupPath).wrappedKey;
    if (wrapped) saveKeyring(req.dataDir, wrapped);
    process.stdout.write(
      JSON.stringify({ ok: true, dbKeyHex: result.dbKeyHex, safetyCopy: result.safetyCopy }),
    );
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : 'Restore failed',
      }),
    );
  }
}

void main();
