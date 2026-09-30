/** What the Electron preload script exposes to pages. Missing in a normal browser and in the test runner. */
interface MediescareBridge {
  printToPdf?: (suggestedName: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
  /** Installed Windows printers. */
  listPrinters?: () => Promise<{ name: string; isDefault: boolean }[]>;
  /** Send ESC/POS bytes (base64) to a printer; an empty name means the system default printer. */
  printRaw?: (
    printerName: string,
    bytesBase64: string,
    opts?: { copies?: number },
  ) => Promise<{ ok: boolean; error?: string }>;
  /** Pulse the cash drawer through the printer's RJ11 port. */
  openDrawer?: (
    printerName: string,
    pin: 'pin2' | 'pin5',
  ) => Promise<{ ok: boolean; error?: string }>;
}

interface Window {
  mediescare?: MediescareBridge;
}
