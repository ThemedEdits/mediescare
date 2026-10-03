import { app, BrowserWindow, ipcMain } from 'electron';
import { resourcePath } from './paths';
import { createOfflineWindow } from './window';

export type OfflineChoice = 'retry' | 'repair' | 'change';

let active: {
  win: BrowserWindow;
  check: () => Promise<boolean>;
  resolve: (c: OfflineChoice) => void;
} | null = null;
let registered = false;

function register(): void {
  ipcMain.handle('terminal:retry', async (event): Promise<{ ok: boolean }> => {
    const a = active;
    if (!a || event.sender !== a.win.webContents) return { ok: false };
    const reachable = await a.check();
    if (reachable) a.resolve('retry');
    return { ok: reachable };
  });
  ipcMain.handle('terminal:leave', (event, choice: string): void => {
    const a = active;
    if (!a || event.sender !== a.win.webContents) return;
    if (choice === 'repair' || choice === 'change') a.resolve(choice);
  });
}

/**
 * The page a terminal shows when its branch server does not answer: what happened, what to check,
 * and Retry, Re-pair and Change server. A terminal holds no data, so there is nothing else to show.
 * Resolves with the user's choice and closes its window. Closing the window quits the app (the
 * caller's window-all-closed rule), so this never resolves in that case.
 */
export function showTerminalOffline(input: {
  serverUrl: string;
  detail: string;
  /** Short health check of the saved server, used by Retry. */
  check: () => Promise<boolean>;
}): Promise<OfflineChoice> {
  if (!registered) {
    register();
    registered = true;
  }
  return new Promise((resolve) => {
    const win = createOfflineWindow(resourcePath('terminal-offline.html'), {
      server: input.serverUrl,
      detail: input.detail.slice(0, 300),
    });
    win.on('closed', () => {
      if (active?.win === win) app.quit(); // closed without a choice
    });
    active = {
      win,
      check: input.check,
      resolve: (choice) => {
        active = null;
        if (!win.isDestroyed()) win.close();
        resolve(choice);
      },
    };
  });
}
