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
});
