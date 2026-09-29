import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { resourcePath, webRoot } from './paths';
import { loadOrCreateSecrets, replaceDbKey } from './secrets';
import type { ServerProcess } from './server';
import { createRestoreWindow } from './window';

interface RestoreRequest {
  backupPath: string;
  recoveryKey: string;
  sameKey: boolean;
}

interface CliResult {
  ok: boolean;
  error?: string;
  dbKeyHex?: string;
}

/** Run the restore tool on Electron's Node, from the web folder so native modules resolve. */
function runRestoreCli(payload: object): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(webRoot(), 'restore-cli.cjs')], {
      cwd: webRoot(),
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.once('error', (e) => resolve({ ok: false, error: e.message }));
    child.once('exit', () => {
      try {
        resolve(JSON.parse(out) as CliResult);
      } catch {
        resolve({ ok: false, error: 'The restore tool did not return a result' });
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

/** Opens the restore window. Restarts the app when the restore finishes (or fails safely). */
export function openRestoreWindow(
  userData: string,
  server: ServerProcess | null,
  parent: BrowserWindow | null,
): void {
  const win = createRestoreWindow(resourcePath('restore.html'), parent);

  ipcMain.removeHandler('restore:pick');
  ipcMain.handle('restore:pick', async (event) => {
    if (event.sender !== win.webContents) return null;
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose a Mediescare backup',
      filters: [{ name: 'Mediescare backup', extensions: ['mcbak'] }],
      properties: ['openFile'],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.removeHandler('restore:run');
  ipcMain.handle('restore:run', async (event, request: RestoreRequest) => {
    if (event.sender !== win.webContents) return { ok: false, error: 'Unexpected sender' };
    const confirm = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Restore', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Replace all data?',
      message: 'Replace all data on this computer with the backup?',
      detail: 'A safety copy of the current data is kept. Mediescare will restart.',
    });
    if (confirm.response !== 0) return { ok: false, error: 'Cancelled' };

    await server?.stopAndWait();
    const dataDir = join(userData, 'data');
    const result = await runRestoreCli({
      backupPath: request.backupPath,
      targetDbFile: join(dataDir, 'mediescare.db'),
      safetyDir: join(userData, 'backups', 'safety'),
      dataDir,
      ...(request.sameKey
        ? { dbKeyHex: loadOrCreateSecrets(userData).dbKeyHex }
        : { recoveryKey: request.recoveryKey }),
    });
    if (!result.ok || !result.dbKeyHex) {
      // The tool verifies everything before replacing anything, so the current data is intact.
      setTimeout(() => {
        app.relaunch();
        app.exit(0);
      }, 3000);
      return {
        ok: false,
        error: `${result.error ?? 'Restore failed'} (Mediescare will restart with the current data.)`,
      };
    }
    if (!request.sameKey) replaceDbKey(userData, result.dbKeyHex);
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 1500);
    return { ok: true };
  });

  win.on('closed', () => {
    ipcMain.removeHandler('restore:pick');
    ipcMain.removeHandler('restore:run');
  });
}
