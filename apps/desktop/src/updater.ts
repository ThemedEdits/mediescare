import { app, BrowserWindow, dialog } from 'electron';
import { autoUpdater, type UpdateInfo } from 'electron-updater';
import { APP_NAME } from '@mediescare/config';
import { updatesEnabled } from './updater-core';

/** First check shortly after start (the app is busy starting the server), then every 4 hours. */
const FIRST_CHECK_MS = 30_000;
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

interface UpdaterOptions {
  window: () => BrowserWindow | null;
  /** Stop the local server and wait, so the installer can replace its files. */
  beforeInstall: () => Promise<void>;
}

let options: UpdaterOptions | null = null;
let busy = false;
/** Versions the user answered "Later" to: asked again after the next start, not every 4 hours. */
const postponed = new Set<string>();

function box(opts: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
  const win = options?.window();
  return win && !win.isDestroyed() ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts);
}

function setProgress(fraction: number): void {
  const win = options?.window();
  if (win && !win.isDestroyed()) win.setProgressBar(fraction);
}

async function offerDownload(info: UpdateInfo): Promise<void> {
  const { response } = await box({
    type: 'info',
    title: 'Update available',
    message: `${APP_NAME} ${info.version} is available`,
    detail: `You have version ${app.getVersion()}. The update downloads in the background; the counter keeps working. Your data is not changed, and a backup is taken before the database is upgraded.`,
    buttons: ['Download update', 'Later'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (response !== 0) {
    postponed.add(info.version);
    return;
  }
  setProgress(0);
  await autoUpdater.downloadUpdate();
}

async function offerRestart(info: UpdateInfo): Promise<void> {
  setProgress(-1);
  const { response } = await box({
    type: 'info',
    title: 'Update ready',
    message: `${APP_NAME} ${info.version} is ready to install`,
    detail:
      'Restart now to finish. Finish any open sale first. If you choose Later, the update is installed the next time Mediescare closes.',
    buttons: ['Restart now', 'Later'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (response !== 0) return;
  await options?.beforeInstall();
  // Silent install, then start Mediescare again.
  autoUpdater.quitAndInstall(true, true);
}

/** Ask GitHub Releases for a newer version. `manual` reports "up to date" and errors to the user. */
export async function checkForUpdates(manual = false): Promise<void> {
  if (!options) {
    if (manual)
      await box({
        type: 'info',
        title: 'Updates',
        message: 'Updates are available only in the installed app.',
        buttons: ['Close'],
      });
    return;
  }
  if (busy) return;
  busy = true;
  try {
    const result = await autoUpdater.checkForUpdates();
    const info = result?.updateInfo;
    if (result?.isUpdateAvailable && info) {
      if (manual || !postponed.has(info.version)) await offerDownload(info);
    } else if (manual) {
      await box({
        type: 'info',
        title: 'Updates',
        message: `${APP_NAME} is up to date`,
        detail: `Version ${app.getVersion()}`,
        buttons: ['Close'],
      });
    }
  } catch (error) {
    setProgress(-1);
    // No internet is normal: the app works offline and checks again later.
    console.error('[update] check failed:', error instanceof Error ? error.message : 'unknown');
    if (manual)
      await box({
        type: 'warning',
        title: 'Updates',
        message: 'Could not check for updates',
        detail: 'Check the internet connection and try again. Mediescare keeps working offline.',
        buttons: ['Close'],
      });
  } finally {
    busy = false;
  }
}

/**
 * Updates from GitHub Releases (electron-builder `publish`, see docs/updates.md). Never blocks start
 * and never needs the network to run: a failed check is silent and retried later.
 */
export function startAutoUpdates(opts: UpdaterOptions): void {
  if (!updatesEnabled({ isPackaged: app.isPackaged, env: process.env })) return;
  options = opts;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;
  autoUpdater.on('download-progress', (p) => setProgress(p.percent / 100));
  autoUpdater.on('update-downloaded', (info) => void offerRestart(info));
  autoUpdater.on('error', () => setProgress(-1));
  setTimeout(() => void checkForUpdates(), FIRST_CHECK_MS).unref();
  setInterval(() => void checkForUpdates(), CHECK_EVERY_MS).unref();
}
