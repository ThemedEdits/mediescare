import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ipcMain } from 'electron';
import { isAllowedSender } from './print-guard';
import {
  RAW_PRINT_SCRIPT,
  PRINT_TIMEOUT_MS,
  buildPowerShellArgs,
  clampCopies,
  decodePayload,
  drawerKickBytes,
  friendlyPrintError,
  LIST_PRINTERS_COMMAND,
  parseWinPrinters,
  type ListedPrinter,
  isValidPrinterName,
} from './printers-core';

export interface RawResult {
  ok: boolean;
  error?: string;
}

/**
 * Installed Windows printers. Electron's own list has no default/offline flags any more, so the
 * printer list comes from Windows (WMI) and Electron's list is only the fallback.
 */
export async function listPrinters(sender: Electron.WebContents): Promise<ListedPrinter[]> {
  if (process.platform === 'win32') {
    const run = await runPowerShell([
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      LIST_PRINTERS_COMMAND,
    ]);
    const listed = run.code === 0 ? parseWinPrinters(run.stdout) : [];
    if (listed.length > 0) return listed;
  }
  const printers = await sender.getPrintersAsync();
  return printers.map((p) => ({ name: p.name, isDefault: false, offline: false }));
}

function runPowerShell(
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number; timedOut: boolean }> {
  const exe = join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  return new Promise((resolve) => {
    execFile(
      exe,
      args,
      { timeout: PRINT_TIMEOUT_MS, windowsHide: true, maxBuffer: 256 * 1024 },
      (error, stdout, stderr) => {
        const e = error as (NodeJS.ErrnoException & { killed?: boolean }) | null;
        resolve({
          stdout: String(stdout),
          stderr: String(stderr),
          code: e ? (typeof e.code === 'number' ? e.code : 1) : 0,
          timedOut: Boolean(e?.killed),
        });
      },
    );
  });
}

/** Sends RAW bytes to a printer that is already known to exist. Empty name is resolved by the caller. */
export async function sendRaw(
  printerName: string,
  bytes: Buffer,
  copies: number,
): Promise<RawResult> {
  if (process.platform !== 'win32')
    return { ok: false, error: 'Native receipt printing is only available on Windows.' };
  const dir = await mkdtemp(join(tmpdir(), 'mediescare-print-'));
  try {
    const scriptPath = join(dir, 'raw-print.ps1');
    const dataPath = join(dir, 'job.bin');
    // A BOM lets Windows PowerShell 5.1 read the script as UTF-8.
    await writeFile(scriptPath, `\uFEFF${RAW_PRINT_SCRIPT}`, 'utf8');
    await writeFile(dataPath, bytes);
    const run = await runPowerShell(buildPowerShellArgs(scriptPath, printerName, dataPath, copies));
    if (run.code === 0 && !run.timedOut) return { ok: true };
    return { ok: false, error: friendlyPrintError(run.stderr, run.timedOut, printerName) };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Checks the name against the installed printers, resolves "" to the default, and refuses offline ones. */
async function resolvePrinter(
  sender: Electron.WebContents,
  requested: unknown,
): Promise<{ name: string } | { error: string }> {
  const name = typeof requested === 'string' ? requested : '';
  if (name !== '' && !isValidPrinterName(name)) return { error: 'The printer name is not valid.' };
  const installed = await listPrinters(sender);
  const found =
    name === '' ? installed.find((p) => p.isDefault) : installed.find((p) => p.name === name);
  if (!found)
    return {
      error:
        name === ''
          ? 'No default printer is set in Windows. Choose a printer in Settings.'
          : `Printer "${name}" was not found. Check the printer name in Settings.`,
    };
  if (found.offline)
    return { error: `Printer "${found.name}" is offline. Check power, cable and paper.` };
  return { name: found.name };
}

export async function printRaw(
  sender: Electron.WebContents,
  printerName: unknown,
  bytesBase64: unknown,
  copies: unknown,
): Promise<RawResult> {
  const decoded = decodePayload(bytesBase64);
  if (!decoded.ok) return { ok: false, error: decoded.error };
  const printer = await resolvePrinter(sender, printerName);
  if ('error' in printer) return { ok: false, error: printer.error };
  return sendRaw(printer.name, decoded.bytes, clampCopies(copies));
}

export async function openDrawer(
  sender: Electron.WebContents,
  printerName: unknown,
  pin: unknown,
): Promise<RawResult> {
  const kick = drawerKickBytes(pin);
  if (!kick) return { ok: false, error: 'Choose drawer connector pin 2 or pin 5.' };
  const printer = await resolvePrinter(sender, printerName);
  if ('error' in printer) return { ok: false, error: printer.error };
  return sendRaw(printer.name, kick, 1);
}

/** A tiny ASCII page: init, text, feed and partial cut. */
export async function testPrint(
  sender: Electron.WebContents,
  printerName: unknown,
): Promise<RawResult> {
  const text = 'Mediescare\nTest print\nIf you can read this, printing works.\n';
  const bytes = Buffer.concat([
    Buffer.from([0x1b, 0x40]),
    Buffer.from(text, 'ascii'),
    Buffer.from([0x1b, 0x64, 4, 0x1d, 0x56, 0x01]),
  ]);
  const printer = await resolvePrinter(sender, printerName);
  if ('error' in printer) return { ok: false, error: printer.error };
  return sendRaw(printer.name, bytes, 1);
}

const DENIED: RawResult = { ok: false, error: 'Not allowed from this page' };

export function registerPrinterHandlers(appOrigin: string): void {
  ipcMain.handle('printer:list', async (event) => {
    if (!isAllowedSender(event.senderFrame?.url, appOrigin)) return [];
    try {
      return await listPrinters(event.sender);
    } catch {
      return [];
    }
  });
  ipcMain.handle(
    'printer:raw',
    async (event, name: unknown, base64: unknown, opts: unknown): Promise<RawResult> => {
      if (!isAllowedSender(event.senderFrame?.url, appOrigin)) return DENIED;
      const copies = (opts as { copies?: unknown } | null | undefined)?.copies;
      return printRaw(event.sender, name, base64, copies).catch(unexpected);
    },
  );
  ipcMain.handle(
    'printer:drawer',
    async (event, name: unknown, pin: unknown): Promise<RawResult> => {
      if (!isAllowedSender(event.senderFrame?.url, appOrigin)) return DENIED;
      return openDrawer(event.sender, name, pin).catch(unexpected);
    },
  );
  ipcMain.handle('printer:test', async (event, name: unknown): Promise<RawResult> => {
    if (!isAllowedSender(event.senderFrame?.url, appOrigin)) return DENIED;
    return testPrint(event.sender, name).catch(unexpected);
  });
}

function unexpected(error: unknown): RawResult {
  return { ok: false, error: error instanceof Error ? error.message : 'Printing failed' };
}
