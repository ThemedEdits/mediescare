import { join } from 'node:path';
import { app, BrowserWindow, dialog, shell } from 'electron';
import { APP_ID, APP_NAME } from '@mediescare/config';
import { loadConfig, type DesktopConfig } from './config';
import { migrationsDir, serverJs } from './paths';
import { loadOrCreateSecrets } from './secrets';
import { pickPort, ServerProcess, waitForHealth } from './server';
import { registerPrintHandlers } from './print';
import { startLanAnnouncing } from './discovery-service';
import { DeviceTokenStore } from './pairing';
import { electronSealer, registerPairingHandlers } from './pairing-ipc';
import { openRestoreWindow } from './restore';
import { offerFirewall, showServerAddress } from './server-dialogs';
import { showTerminalOffline } from './terminal-offline';
import { runWizard } from './wizard-ipc';
import { buildAppMenu, createMainWindow, removeAppMenu, showFatal } from './window';

app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
// Tests and support can point the app at a different data folder.
if (process.env.MEDIESCARE_USER_DATA) app.setPath('userData', process.env.MEDIESCARE_USER_DATA);

let server: ServerProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let stopAnnouncing: (() => void) | null = null;
// The wizard window closing must not quit the app before the main window exists.
let running = false;
let repairing = false;
/** A terminal waits this long for its server before showing the offline page. */
const TERMINAL_WAIT_MS = 5_000;

const messageBox = (
  options: Electron.MessageBoxOptions,
): Promise<Electron.MessageBoxReturnValue> =>
  mainWindow && !mainWindow.isDestroyed()
    ? dialog.showMessageBox(mainWindow, options)
    : dialog.showMessageBox(options);

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
  // First run: the wizard. Closing it quits the app, so it always returns a config here.
  const config = loadConfig(userData) ?? (await runWizard(userData));
  if (config) await boot(userData, config);
}

async function boot(userData: string, config: DesktopConfig): Promise<void> {
  removeAppMenu();
  if (config.mode === 'terminal') await bootTerminal(userData, config);
  else await bootLocal(userData, config);
}

/** Single PC and Branch Server: start the local server and open it. */
async function bootLocal(userData: string, config: DesktopConfig): Promise<void> {
  const devUrl = process.env.MEDIESCARE_DEV_URL;
  try {
    let origin: string;
    if (devUrl) {
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
    await waitForHealth(origin, 45_000);
    mainWindow = createMainWindow(origin);
    registerPrintHandlers(origin);
    const port = Number(new URL(origin).port);
    if (config.mode === 'branch-server') {
      stopAnnouncing = startLanAnnouncing({ origin, port });
    }
    running = true;
    // Terminals hold no data, so only servers get the restore and backup-folder menu.
    buildAppMenu({
      restore: () => openRestoreWindow(userData, server, mainWindow),
      openBackups: () => void shell.openPath(join(userData, 'backups')),
      ...(config.mode === 'branch-server'
        ? {
            serverAddress: () => void showServerAddress(mainWindow, port),
            allowFirewall: () => void offerFirewall(mainWindow, port),
          }
        : {}),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown error';
    const win = new BrowserWindow({ width: 640, height: 420, title: APP_NAME });
    showFatal(
      win,
      'Mediescare could not start',
      `${detail} Logs are in ${join(userData, 'logs')}.`,
    );
    mainWindow = win;
    running = true;
  }
}

const reachable = (origin: string, ms: number): Promise<boolean> =>
  waitForHealth(origin, ms).then(
    () => true,
    () => false,
  );

/**
 * Terminal: holds no data and only shows the branch server. If the server does not answer, show the
 * offline page (Retry, Re-pair, Change server) instead of an empty window.
 */
async function bootTerminal(userData: string, config: DesktopConfig): Promise<void> {
  const origin = config.serverUrl;
  if (!origin || !(await reachable(origin, TERMINAL_WAIT_MS))) {
    const choice = await showTerminalOffline({
      serverUrl: origin ?? '',
      detail: origin
        ? 'No answer from the server.'
        : 'No server address is saved for this terminal.',
      check: () => (origin ? reachable(origin, 4_000) : Promise.resolve(false)),
    });
    if (choice === 'retry') return bootTerminal(userData, config);
    const next = await runWizard(userData, {
      terminalOnly: true,
      serverUrl: choice === 'repair' ? origin : undefined,
    });
    // Cancelled: the saved setup stays as it was and the offline page comes back.
    return boot(userData, next ?? loadConfig(userData) ?? config);
  }
  mainWindow = createMainWindow(origin);
  registerPrintHandlers(origin);
  registerPairingHandlers(userData, origin);
  running = true;
  buildAppMenu({
    showServer: () =>
      void messageBox({
        type: 'info',
        title: 'Connected server',
        message: 'This terminal shows the Branch Server',
        detail: `${origin}\n\nThis counter keeps no data of its own.`,
        buttons: ['Close'],
      }),
    repair: () => void repairFromMenu(userData, origin),
  });
}

/**
 * Re-pair or change server while the terminal is open. A new server needs new handlers bound to its
 * address, so after a successful pairing the app restarts into the new setup. Cancel changes nothing.
 */
async function repairFromMenu(userData: string, origin: string): Promise<void> {
  if (repairing) return;
  repairing = true;
  try {
    const choice = await messageBox({
      type: 'question',
      title: 'Re-pair or change server',
      message: 'Pair this counter with a server again?',
      detail: `Current server: ${origin}\nYou need a new pairing code from the Branch Server.`,
      buttons: ['Re-pair with this server', 'Change server', 'Cancel'],
      defaultId: 2,
      cancelId: 2,
      noLink: true,
    });
    if (choice.response === 2) return;
    const next = await runWizard(userData, {
      terminalOnly: true,
      serverUrl: choice.response === 0 ? origin : undefined,
    });
    if (next) {
      app.relaunch();
      app.exit(0);
    }
  } finally {
    repairing = false;
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
