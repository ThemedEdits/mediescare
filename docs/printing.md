# Thermal printing and cash drawer

Mediescare prints receipts straight to an ESC/POS thermal printer from the desktop app and opens the
cash drawer through the printer's RJ11 port. In a plain browser (or if native printing fails) it falls
back to the normal browser print dialog. The sale is always saved first; a print problem never loses it.

## Setup on Windows

1. Install the printer's Windows driver (from the maker's CD or website) and connect it by USB.
   Check that Windows lists it under Printers & scanners. The printer is used as a normal Windows
   printer; Mediescare sends raw ESC/POS bytes to it through the Windows print spooler.
2. Connect the cash drawer's cable to the RJ11 (telephone-style) socket on the printer, not to the PC.
3. Open Settings, printer section. Pick the printer from the dropdown (the names are exactly those
   shown in Windows). Leaving it empty uses the Windows default printer.
4. Choose paper width: 80 mm (48 columns, the standard) or 58 mm (32 columns).
5. Choose the drawer connector. Pin 2 suits most drawers; try pin 5 if the drawer does not open.
6. Press "Print test receipt" and "Open cash drawer". They use the values on screen, before saving.
7. Tick "Print automatically" if the receipt should print right after each sale, and "Open drawer on
   cash" to kick the drawer whenever a sale has a cash payment. Copies (1 to 3) is honoured.

Settings are per branch (`print.*` keys, plus `pos.invoice_note`). The printer is chosen on the PC where
the POS runs, so on a terminal PC the selected name must exist on that PC.

## How it works

- `packages/core/src/escpos.ts` (subpath `@mediescare/core/escpos`) is a pure encoder: init, code page
  PC858, alignment, bold/double height for the total, wrapped item names, right-aligned money using
  `formatMinor` (integer paisa, no floats), feed, partial cut (`GS V 1`) and the drawer pulse
  (`ESC p m t1 t2`, pin 2 or 5).
- `apps/web/src/lib/receipt.ts` builds the receipt from the sale response. Cost and profit are never
  included. With one copy the drawer pulse is sent in the same job before the receipt; with several
  copies it is sent once, separately.
- `apps/desktop/src/printers.ts` lists printers (Windows WMI, Electron list as fallback) and writes the
  bytes to a temporary file that a fixed PowerShell script sends to the spooler as a RAW document
  (`winspool.drv`). No native npm dependency is needed. The printer name is validated, checked against
  the installed list, and passed as a separate process argument (never built into a command string).
  Jobs are limited to 256 KB and 20 seconds; the temporary files are deleted afterwards. Only the
  app's own pages may call these IPC handlers.

## Tested and not tested

Tested automatically: exact ESC/POS command bytes, column alignment at 48 and 32 columns, wrapping,
money formatting, printer-name validation, base64 size limits, PowerShell argument building, printer
list parsing, friendly error text. The PowerShell script was also run on Windows against a printer
name that does not exist and correctly reported "not found".

NOT tested (no hardware here): printing to a real thermal printer, the partial cut, the drawer
pulse timing, and an offline or out-of-paper printer. Windows may accept a job for an offline printer
and hold it in the queue; Mediescare only refuses printers Windows reports as offline. Please run
the test buttons on the real printer and drawer before go-live.

## Limitations

- Urdu (and any character outside the Latin code page) prints as `?` on thermal receipts. Urdu needs
  raster printing (the receipt drawn as a bitmap), which is not part of this work. Use English item
  names on receipts until then.
- Printing is Windows only. On other systems the app falls back to the browser print dialog.
