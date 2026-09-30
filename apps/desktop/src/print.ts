import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { isAllowedSender, pdfFileName } from './print-guard';

export interface PrintResult {
  ok: boolean;
  path?: string;
  error?: string;
}

/**
 * "Save as PDF" for report pages: prints the calling page (its print stylesheet decides what shows)
 * to landscape A4 and lets the user choose where to save it. Only the app's own pages may call it.
 */
export function registerPrintHandlers(appOrigin: string): void {
  ipcMain.handle('print:pdf', async (event, suggestedName: unknown): Promise<PrintResult> => {
    if (!isAllowedSender(event.senderFrame?.url, appOrigin))
      return { ok: false, error: 'Not allowed from this page' };
    try {
      const data = await event.sender.printToPDF({
        landscape: true,
        pageSize: 'A4',
        printBackground: true,
      });
      const win = BrowserWindow.fromWebContents(event.sender);
      const options = {
        title: 'Save as PDF',
        defaultPath: join(app.getPath('documents'), pdfFileName(suggestedName)),
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      };
      const chosen = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options);
      if (chosen.canceled || !chosen.filePath) return { ok: false, error: 'Cancelled' };
      await writeFile(chosen.filePath, data);
      return { ok: true, path: chosen.filePath };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Could not save the PDF',
      };
    }
  });
}
