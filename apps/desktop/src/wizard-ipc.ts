import { app, BrowserWindow, ipcMain } from 'electron';
import { DEFAULT_PORT } from '@mediescare/config';
import type { DesktopConfig } from './config';
import { discoverServers } from './discovery';
import { allowThroughFirewall, firewallCommands } from './firewall';
import { electronSealer } from './pairing-ipc';
import { resourcePath } from './paths';
import { createWizardCore, type WizardCore } from './wizard-core';
import { createWizardWindow } from './window';

export interface WizardOptions {
  /** Re-pair or change server: only the terminal steps, and closing the window cancels. */
  terminalOnly?: boolean;
  /** Address to prefill (re-pair keeps the current server). */
  serverUrl?: string;
}

interface Active {
  win: BrowserWindow;
  core: WizardCore;
  options: WizardOptions;
  finish: (config: DesktopConfig | null) => void;
}

let active: Active | null = null;
let registered = false;

function register(): void {
  const guard =
    <A extends unknown[], R>(fn: (a: Active, ...args: A) => R | Promise<R>, denied: R) =>
    async (event: Electron.IpcMainInvokeEvent, ...args: A): Promise<R> =>
      active && event.sender === active.win.webContents ? fn(active, ...args) : denied;
  const denied = { ok: false as const, kind: 'other' as const, error: 'Unexpected sender' };

  ipcMain.handle(
    'wizard:init',
    guard(
      (a) => ({
        terminalOnly: a.options.terminalOnly === true,
        serverUrl: a.options.serverUrl ?? '',
        deviceName: a.core.defaultDeviceName(),
        firewallCommands: firewallCommands(a.core.defaultPort()),
        windows: process.platform === 'win32',
      }),
      null,
    ),
  );
  ipcMain.handle(
    'wizard:discover',
    guard((a) => a.core.discover(), []),
  );
  ipcMain.handle(
    'wizard:check',
    guard((a, address: string) => a.core.checkAddress(address), denied),
  );
  ipcMain.handle(
    'wizard:choose-local',
    guard((a, mode: string) => {
      const result = a.core.chooseLocal(mode);
      if (result.ok) closeWith(a, result.config);
      return result.ok ? { ok: true as const } : result;
    }, denied),
  );
  ipcMain.handle(
    'wizard:pair',
    guard(async (a, request: { serverUrl: string; code: string; deviceName: string }) => {
      const result = await a.core.pairTerminal(request);
      if (!result.ok) return result;
      closeWith(a, result.config);
      return { ok: true as const, branchCode: result.branchCode };
    }, denied),
  );
  // Only an explicit click on the page's button reaches this; Windows then shows its own admin prompt.
  ipcMain.handle(
    'wizard:firewall',
    guard((a) => allowThroughFirewall(a.core.defaultPort()), {
      ok: false as const,
      error: 'Unexpected sender',
      commands: firewallCommands(DEFAULT_PORT),
    }),
  );
}

function closeWith(a: Active, config: DesktopConfig): void {
  const finish = a.finish;
  // Let the page show its success text for a moment before the window goes away.
  setTimeout(() => finish(config), 600);
}

/**
 * Shows the setup wizard. Resolves with the saved config, or null if the window was closed while
 * `terminalOnly` (an existing setup stays as it was). Closing the first-run wizard quits the app.
 */
export function runWizard(
  userData: string,
  options: WizardOptions = {},
): Promise<DesktopConfig | null> {
  if (!registered) {
    register();
    registered = true;
  }
  return new Promise((resolve) => {
    const query = options.terminalOnly ? { terminal: '1' } : undefined;
    const win = createWizardWindow(resourcePath('wizard.html'), query);
    let done = false;
    const finish = (config: DesktopConfig | null): void => {
      if (done) return;
      done = true;
      active = null;
      if (!win.isDestroyed()) win.close();
      resolve(config);
    };
    active = {
      win,
      options,
      finish,
      core: createWizardCore({
        userData,
        sealer: electronSealer,
        discover: () => discoverServers(),
        port: DEFAULT_PORT,
      }),
    };
    win.on('closed', () => {
      if (done) return;
      done = true;
      active = null;
      if (options.terminalOnly) resolve(null);
      else app.quit();
    });
  });
}
