import { BrowserWindow, Menu, session, shell } from 'electron';
import { APP_NAME } from '@mediescare/config';
import { iconPath, preloadPath } from './paths';

/** Locked-down window: no Node in the page, no popups, no navigation away from the app origin. */
export function createMainWindow(origin: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1024,
    minHeight: 600,
    title: APP_NAME,
    icon: iconPath(),
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      preload: preloadPath(),
    },
  });
  win.once('ready-to-show', () => win.show());

  const allowed = new URL(origin).origin;
  win.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== allowed) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    // External links open in the user's browser, never inside the app.
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );

  void win.loadURL(origin);
  return win;
}

export function createWizardWindow(
  htmlFile: string,
  query?: Record<string, string>,
): BrowserWindow {
  const win = new BrowserWindow({
    width: 620,
    height: 640,
    resizable: false,
    title: `${APP_NAME} setup`,
    icon: iconPath(),
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: preloadPath(),
    },
  });
  win.setMenuBarVisibility(false);
  void win.loadFile(htmlFile, query ? { query } : undefined);
  return win;
}

export function createRestoreWindow(htmlFile: string, parent: BrowserWindow | null): BrowserWindow {
  const win = new BrowserWindow({
    width: 620,
    height: 640,
    parent: parent ?? undefined,
    modal: parent !== null,
    resizable: false,
    title: `${APP_NAME}: restore from backup`,
    icon: iconPath(),
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: preloadPath(),
    },
  });
  win.setMenuBarVisibility(false);
  void win.loadFile(htmlFile);
  return win;
}

const viewMenu: Electron.MenuItemConstructorOptions = {
  label: 'View',
  submenu: [
    { role: 'reload' },
    { role: 'togglefullscreen' },
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
  ],
};

export interface MenuActions {
  /** Servers only (Single PC and Branch Server): restore and backup folder. */
  restore?: () => void;
  openBackups?: () => void;
  /** Branch Server: show the LAN address, create a pairing code, allow the firewall. */
  serverAddress?: () => void;
  allowFirewall?: () => void;
  /** Terminal: show the connected server, or pick another one and pair again. */
  showServer?: () => void;
  repair?: () => void;
}

export function buildAppMenu(items: MenuActions): void {
  const data: Electron.MenuItemConstructorOptions[] = [];
  if (items.restore) data.push({ label: 'Restore from backup…', click: items.restore });
  if (items.openBackups) data.push({ label: 'Open backup folder', click: items.openBackups });
  if (data.length) data.push({ type: 'separator' });
  data.push({ role: 'quit', label: 'Quit' });
  const template: Electron.MenuItemConstructorOptions[] = [{ label: 'Data', submenu: data }];

  const network: Electron.MenuItemConstructorOptions[] = [];
  if (items.serverAddress)
    network.push({ label: 'Server address and pairing code…', click: items.serverAddress });
  if (items.allowFirewall)
    network.push({ label: 'Allow through Windows Firewall…', click: items.allowFirewall });
  if (items.showServer) network.push({ label: 'Connected server…', click: items.showServer });
  if (items.repair) network.push({ label: 'Re-pair or change server…', click: items.repair });
  if (network.length) template.push({ label: 'Network', submenu: network });

  template.push(viewMenu);
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** Window for the "cannot reach the branch server" page. It loads only our own file. */
export function createOfflineWindow(
  htmlFile: string,
  query: Record<string, string>,
): BrowserWindow {
  const win = new BrowserWindow({
    width: 720,
    height: 680,
    title: `${APP_NAME}: branch server not reachable`,
    icon: iconPath(),
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: preloadPath(),
    },
  });
  win.setMenuBarVisibility(false);
  void win.loadFile(htmlFile, { query });
  return win;
}

export function showFatal(win: BrowserWindow, title: string, detail: string): void {
  const esc = (s: string) =>
    s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);
  const html = `<meta charset="utf-8"><body style="font-family:Segoe UI,sans-serif;max-width:560px;margin:48px auto;color:#0f172a">
    <h1 style="font-size:22px">${esc(title)}</h1><p style="color:#475569">${esc(detail)}</p></body>`;
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

export function removeAppMenu(): void {
  Menu.setApplicationMenu(null);
}
