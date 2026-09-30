/** Pure helpers for raw printing: validation, limits and the PowerShell command line. No electron, no I/O. */

/** A receipt is a few KB; 256 KB leaves room for a logo bitmap later and stops abuse. */
export const MAX_PRINT_BYTES = 256 * 1024;
export const MAX_COPIES = 5;
export const PRINT_TIMEOUT_MS = 20_000;

/** ESC p m t1 t2 with the same timings as @mediescare/core/escpos drawerKick. */
export function drawerKickBytes(pin: unknown): Buffer | null {
  if (pin !== 'pin2' && pin !== 'pin5') return null;
  return Buffer.from([0x1b, 0x70, pin === 'pin2' ? 0 : 1, 25, 250]);
}

/**
 * Windows printer names: letters, digits and a few punctuation marks (also UNC "\\server\printer").
 * Quotes, control characters and shell metacharacters are refused. The name is only ever passed as a
 * separate process argument, never joined into a command string, so this is defence in depth.
 */
export function isValidPrinterName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= 200 &&
    name.trim() === name &&
    /^[\p{L}\p{N} ._()#,+\-[\]\\&']+$/u.test(name)
  );
}

export type Decoded = { ok: true; bytes: Buffer } | { ok: false; error: string };

/** Strict base64 decode with a size limit. */
export function decodePayload(base64: unknown): Decoded {
  if (typeof base64 !== 'string' || base64.length === 0)
    return { ok: false, error: 'Nothing to print' };
  // 4 base64 characters carry 3 bytes; check before allocating.
  if (base64.length > Math.ceil((MAX_PRINT_BYTES * 4) / 3) + 4)
    return { ok: false, error: 'The print job is too large' };
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 !== 0)
    return { ok: false, error: 'The print data is not valid' };
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length > MAX_PRINT_BYTES) return { ok: false, error: 'The print job is too large' };
  return { ok: true, bytes };
}

export function clampCopies(copies: unknown): number {
  const n = typeof copies === 'number' && Number.isInteger(copies) ? copies : 1;
  return Math.min(MAX_COPIES, Math.max(1, n));
}

export interface ListedPrinter {
  name: string;
  isDefault: boolean;
  offline: boolean;
}

/** Fixed script (no user input): installed printers as JSON. PrinterStatus 7 means offline. */
export const LIST_PRINTERS_COMMAND =
  'Get-CimInstance Win32_Printer | ForEach-Object { [pscustomobject]@{ name = $_.Name; isDefault = [bool]$_.Default; offline = ([bool]$_.WorkOffline -or $_.PrinterStatus -eq 7) } } | ConvertTo-Json -Compress';

/** Reads the JSON printed by LIST_PRINTERS_COMMAND; anything unexpected gives an empty list. */
export function parseWinPrinters(stdout: string): ListedPrinter[] {
  try {
    const raw: unknown = JSON.parse(stdout.trim() || '[]');
    const rows = Array.isArray(raw) ? raw : [raw];
    return rows.flatMap((r) => {
      const o = r as { name?: unknown; isDefault?: unknown; offline?: unknown } | null;
      return o && typeof o.name === 'string' && o.name
        ? [{ name: o.name, isDefault: o.isDefault === true, offline: o.offline === true }]
        : [];
    });
  } catch {
    return [];
  }
}

/** Arguments for powershell.exe. Values are separate array items (no shell, no string interpolation). */
export function buildPowerShellArgs(
  scriptPath: string,
  printerName: string,
  dataPath: string,
  copies: number,
): string[] {
  return [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    '-PrinterName',
    printerName,
    '-DataPath',
    dataPath,
    '-Copies',
    String(copies),
  ];
}

/** Sends the bytes of a file to the spooler as a RAW document. Errors: "ERR:<step>:<win32 code>". */
export const RAW_PRINT_SCRIPT = `param(
  [Parameter(Mandatory = $true)][string]$PrinterName,
  [Parameter(Mandatory = $true)][string]$DataPath,
  [int]$Copies = 1
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern int StartDocPrinter(IntPtr handle, int level, [In] DOCINFO doc);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool WritePrinter(IntPtr handle, byte[] bytes, int count, out int written);
  public static string Send(string printer, byte[] data) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) return "ERR:open:" + Marshal.GetLastWin32Error();
    try {
      DOCINFO di = new DOCINFO();
      di.pDocName = "Mediescare receipt";
      di.pDataType = "RAW";
      if (StartDocPrinter(h, 1, di) == 0) return "ERR:startdoc:" + Marshal.GetLastWin32Error();
      try {
        if (!StartPagePrinter(h)) return "ERR:startpage:" + Marshal.GetLastWin32Error();
        int written;
        bool ok = WritePrinter(h, data, data.Length, out written);
        EndPagePrinter(h);
        if (!ok || written != data.Length) return "ERR:write:" + Marshal.GetLastWin32Error();
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
    return "OK";
  }
}
'@
$data = [System.IO.File]::ReadAllBytes($DataPath)
for ($i = 0; $i -lt $Copies; $i++) {
  $result = [RawPrinter]::Send($PrinterName, $data)
  if ($result -ne 'OK') { [Console]::Error.WriteLine($result); exit 2 }
}
exit 0
`;

/** Turns a script failure into a sentence the cashier can act on. */
export function friendlyPrintError(stderr: string, timedOut: boolean, printer: string): string {
  const shown = printer || 'the default printer';
  if (timedOut) return `Printing timed out. Check that ${shown} is switched on and connected.`;
  const m = /ERR:(\w+):(\d+)/.exec(stderr);
  if (m) {
    const code = Number(m[2]);
    if (m[1] === 'open' && (code === 1801 || code === 1802 || code === 2))
      return `Printer "${printer}" was not found. Check the printer name in Settings.`;
    if (code === 5) return `Windows refused access to ${shown}.`;
    if (code === 1796 || code === 1797 || code === 21 || code === 1722)
      return `${shown} is not ready. Check the cable, power and paper.`;
    return `Could not print to ${shown} (${m[1]} error ${code}).`;
  }
  if (/is not recognized|cannot find|not found/i.test(stderr))
    return 'Windows PowerShell is not available, so raw printing cannot run.';
  return `Could not print to ${shown}.`;
}
