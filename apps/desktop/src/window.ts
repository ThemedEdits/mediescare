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
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

  void win.loadURL(origin);
  return win;
}

export function createWizardWindow(htmlFile: string): BrowserWindow {
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
  void win.loadFile(htmlFile);
  return win;
}

export function showFatal(win: BrowserWindow, title: string, detail: string): void {
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);
  const html = `<meta charset="utf-8"><body style="font-family:Segoe UI,sans-serif;max-width:560px;margin:48px auto;color:#0f172a">
    <h1 style="font-size:22px">${esc(title)}</h1><p style="color:#475569">${esc(detail)}</p></body>`;
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

export function removeAppMenu(): void {
  Menu.setApplicationMenu(null);
}
