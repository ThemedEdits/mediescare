import { contextBridge, ipcRenderer } from 'electron';

/** The only bridge from the app pages, wizard and restore pages to the main process. */
contextBridge.exposeInMainWorld('mediescare', {
  completeSetup: (choice: {
    mode: 'single' | 'branch-server' | 'terminal';
    serverUrl?: string;
  }): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('wizard:complete', choice),
  pickBackup: (): Promise<string | null> => ipcRenderer.invoke('restore:pick'),
  restoreBackup: (request: {
    backupPath: string;
    recoveryKey: string;
    sameKey: boolean;
  }): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('restore:run', request),
  /** Print the current page to a landscape A4 PDF and ask where to save it. */
  printToPdf: (suggestedName: string): Promise<{ ok: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('print:pdf', suggestedName),
  /** Installed Windows printers (empty when the list cannot be read). */
  listPrinters: (): Promise<{ name: string; isDefault: boolean }[]> =>
    ipcRenderer.invoke('printer:list'),
  /** Send ESC/POS bytes (base64) straight to a printer. Empty name = the system default printer. */
  printRaw: (
    printerName: string,
    bytesBase64: string,
    opts?: { copies?: number },
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('printer:raw', printerName, bytesBase64, opts),
  /** Pulse the cash drawer through the printer's RJ11 port. */
  openDrawer: (
    printerName: string,
    pin: 'pin2' | 'pin5',
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('printer:drawer', printerName, pin),
  /** Terminal: branch servers found on the LAN. */
  discoverServers: (): Promise<
    { name: string; branchCode: string; host: string; port: number; url: string }[]
  > => ipcRenderer.invoke('lan:discover'),
  /** Terminal: exchange the one-time code shown on the branch server for a device token (kept sealed, never returned). */
  pairWithServer: (request: {
    serverUrl: string;
    code: string;
    deviceName: string;
  }): Promise<{ ok: boolean; deviceId?: string; error?: string }> =>
    ipcRenderer.invoke('lan:pair', request),
});
