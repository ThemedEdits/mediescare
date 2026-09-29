import { contextBridge, ipcRenderer } from 'electron';

/** The only bridge from the first-run wizard page to the main process. */
contextBridge.exposeInMainWorld('mediescare', {
  completeSetup: (choice: { mode: 'single' | 'branch-server' | 'terminal'; serverUrl?: string }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('wizard:complete', choice),
});
