import { BrowserWindow, clipboard, dialog } from 'electron';
import { describePairingAnswer, serverAddressText } from './server-info';
import { allowThroughFirewall, firewallCommands, lanAddresses } from './firewall';

/**
 * Branch Server: shows the LAN address, and creates a pairing code through the existing admin API.
 * The request runs inside the signed-in main window, so it has the admin's own session and rights;
 * the shell never holds credentials. The server keeps the usual rules (single use, 10 minutes,
 * hashed, rate limited).
 */
export async function showServerAddress(win: BrowserWindow | null, port: number): Promise<void> {
  const addresses = lanAddresses();
  const text = serverAddressText(port, addresses);
  const options = {
    type: 'info' as const,
    title: 'Server address and pairing code',
    message: 'Branch Server',
    detail: text,
    buttons: ['New terminal pairing code', 'Copy address', 'Close'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  };
  const { response } = win
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options);
  if (response === 1 && addresses[0]) clipboard.writeText(`http://${addresses[0]}:${port}`);
  if (response !== 0) return;
  if (!win || win.isDestroyed()) return;
  let result: ReturnType<typeof describePairingAnswer>;
  try {
    const answer = (await win.webContents.executeJavaScript(
      `fetch('/api/sync/pairing-code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
         .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))`,
    )) as Parameters<typeof describePairingAnswer>[0];
    result = describePairingAnswer(answer);
  } catch {
    result = { ok: false, message: 'Could not ask the server for a code.' };
  }
  await dialog.showMessageBox(win, {
    type: result.ok ? 'info' : 'warning',
    title: 'Terminal pairing code',
    message: result.ok ? result.code : 'No code was created',
    detail: result.ok
      ? 'Type this code on the terminal. It works once and for 10 minutes. A new code replaces this one.'
      : result.message,
    buttons: ['Close'],
  });
}

/** Branch Server: opt-in firewall rules. Asks first; Windows then shows its own administrator prompt. */
export async function offerFirewall(win: BrowserWindow | null, port: number): Promise<void> {
  const commands = firewallCommands(port);
  const ask = {
    type: 'question' as const,
    title: 'Allow through Windows Firewall',
    message: 'Let terminals reach this Branch Server?',
    detail: `This adds two Windows Firewall rules for the local network only (TCP ${port} and UDP 3211). Windows will ask for administrator permission.\n\nOr run these commands yourself as administrator:\n\n${commands.join('\n')}`,
    buttons: ['Allow', 'Copy commands', 'Cancel'],
    defaultId: 2,
    cancelId: 2,
    noLink: true,
  };
  const { response } = win
    ? await dialog.showMessageBox(win, ask)
    : await dialog.showMessageBox(ask);
  if (response === 1) clipboard.writeText(commands.join('\r\n'));
  if (response !== 0) return;
  const result = await allowThroughFirewall(port);
  const done = {
    type: result.ok ? ('info' as const) : ('warning' as const),
    title: 'Windows Firewall',
    message: result.ok ? 'Done. Terminals can now reach this PC.' : 'The firewall was not changed',
    detail: result.ok ? '' : `${result.error}\n\n${result.commands.join('\n')}`,
    buttons: ['Close'],
  };
  if (win) await dialog.showMessageBox(win, done);
  else await dialog.showMessageBox(done);
}
