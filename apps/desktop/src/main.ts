import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { APP_ID, APP_NAME, DEFAULT_PORT, type RuntimeMode } from '@mediescare/config';
import { loadConfig, normaliseServerUrl, saveConfig, type DesktopConfig } from './config';
import { migrationsDir, resourcePath, serverJs } from './paths';
import { loadOrCreateSecrets } from './secrets';
import { pickPort, ServerProcess, waitForHealth } from './server';
import { registerPrintHandlers } from './print';
import { startLanAnnouncing } from './discovery-service';
import { DeviceTokenStore } from './pairing';
import { electronSealer, registerPairingHandlers } from './pairing-ipc';
import { openRestoreWindow } from './restore';
import {
  buildAppMenu,
  createMainWindow,
  createWizardWindow,
  removeAppMenu,
  showFatal,
} from './window';

app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
// Tests and support can point the app at a different data folder.
if (process.env.MEDIESCARE_USER_DATA) app.setPath('userData', process.env.MEDIESCARE_USER_DATA);

let server: ServerProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let stopAnnouncing: (() => void) | null = null;
// The wizard window closing must not quit the app before the main window exists.
let running = false;

function runWizard(userData: string): Promise<DesktopConfig> {
  return new Promise((resolve) => {
    const wizard = createWizardWindow(resourcePath('wizard.html'));
    let done = false;
    ipcMain.handle(
      'wizard:complete',
      (event, choice: { mode: RuntimeMode; serverUrl?: string }) => {
        if (event.sender !== wizard.webContents) return { ok: false, error: 'Unexpected sender' };
        try {
          if (!['single', 'branch-server', 'terminal'].includes(choice.mode))
            throw new Error('Choose how this PC is used');
          const config: DesktopConfig = { mode: choice.mode, port: DEFAULT_PORT };
          if (choice.mode === 'terminal')
            config.serverUrl = normaliseServerUrl(choice.serverUrl ?? '');
          saveConfig(userData, config);
          done = true;
          wizard.close();
          resolve(config);
          return { ok: true };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : 'Invalid choice' };
        }
      },
    );
    wizard.on('closed', () => {
      if (!done) app.quit();
    });
  });
}

/** Opt-in cloud sync: both the address and a device token must be present, otherwise sync stays off. */
function cloudSettings(userData: string): { url: string; token: string } | undefined {
  const url = process.env.MEDIESCARE_CLOUD_URL?.trim();
  const token =
    process.env.MEDIESCARE_CLOUD_TOKEN?.trim() ||
    new DeviceTokenStore(userData, electronSealer).load('cloud');
  return url && token ? { url, token } : undefined;
}

async function start(): Promise<void> {
  const userData = app.getPath('userData');
  const config = loadConfig(userData) ?? (await runWizard(userData));
  removeAppMenu();

  const devUrl = process.env.MEDIESCARE_DEV_URL;
  let origin: string;
  try {
    if (config.mode === 'terminal') {
      if (!config.serverUrl) throw new Error('No server address is saved for this terminal.');
      origin = config.serverUrl;
    } else if (devUrl) {
      origin = devUrl;
    } else {
      const port = await pickPort(config.port);
      server = new ServerProcess({
        serverJs: serverJs(),
        migrationsDir: migrationsDir(),
        dataDir: join(userData, 'data'),
        logDir: join(userData, 'logs'),
        mode: config.mode,
        port,
        secrets: loadOrCreateSecrets(userData),
        cloud: cloudSettings(userData),
      });
      server.start();
      origin = server.url;
    }
    await waitForHealth(origin, config.mode === 'terminal' ? 8_000 : 45_000);
    mainWindow = createMainWindow(origin);
    registerPrintHandlers(origin);
    if (config.mode === 'terminal') registerPairingHandlers(userData, origin);
    if (config.mode === 'branch-server') {
      stopAnnouncing = startLanAnnouncing({ origin, port: Number(new URL(origin).port) });
    }
    running = true;
    if (config.mode !== 'terminal') {
      // Terminals hold no data, so only servers get the restore and backup-folder menu.
      buildAppMenu({
        restore: () => openRestoreWindow(userData, server, mainWindow),
        openBackups: () => void shell.openPath(join(userData, 'backups')),
      });
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown error';
    const win = new BrowserWindow({ width: 640, height: 420, title: APP_NAME });
    showFatal(
      win,
      config.mode === 'terminal' ? 'Branch server not reachable' : 'Mediescare could not start',
      config.mode === 'terminal'
        ? `Could not reach ${config.serverUrl ?? 'the server'}. Check that the Branch Server PC is on and connected to the same network. (${detail})`
        : `${detail} Logs are in ${join(userData, 'logs')}.`,
    );
    mainWindow = win;
    running = true;
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    // `Mediescare.exe --quit` asks the running instance to shut down cleanly (installer, updater, tests).
    if (argv.includes('--quit')) {
      app.quit();
      return;
    }
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app
    .whenReady()
    .then(start)
    .catch((error: unknown) => {
      dialog.showErrorBox(
        `${APP_NAME} failed to start`,
        error instanceof Error ? error.message : String(error),
      );
      app.quit();
    });
  app.on('window-all-closed', () => {
    if (running) app.quit();
  });
  app.on('before-quit', () => {
    stopAnnouncing?.();
    server?.stop();
  });
}
