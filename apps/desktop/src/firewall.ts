import { execFile } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { DISCOVERY_PORT } from './discovery';

/**
 * Windows Firewall helper for the Branch Server PC. Terminals need to reach TCP <port> (the app)
 * and UDP 3211 (discovery). Rules are limited to the local subnet and to private and domain networks.
 * Nothing here runs by itself: the wizard and the menu call allowThroughFirewall only after the user clicks
 * the button, and Windows then shows its own administrator (UAC) prompt.
 */
const TCP_RULE = 'Mediescare-Server-TCP';
const UDP_RULE = 'Mediescare-Discovery-UDP';

const addRule = (name: string, protocol: 'TCP' | 'UDP', port: number): string =>
  `netsh advfirewall firewall add rule name=${name} dir=in action=allow protocol=${protocol} localport=${port} remoteip=localsubnet profile=private,domain`;
const deleteRule = (name: string): string => `netsh advfirewall firewall delete rule name=${name}`;

/** The two commands the owner can run in an administrator Command Prompt. */
export function firewallCommands(port: number): string[] {
  return [addRule(TCP_RULE, 'TCP', port), addRule(UDP_RULE, 'UDP', DISCOVERY_PORT)];
}

/** One cmd.exe line: remove old copies of our rules (ignoring errors), then add both. */
export function firewallScript(port: number): string {
  const [tcp, udp] = firewallCommands(port) as [string, string];
  return `${deleteRule(TCP_RULE)} & ${deleteRule(UDP_RULE)} & ${tcp} && ${udp}`;
}

/** The PowerShell wrapper that asks Windows for administrator rights and returns the exit code. */
export function elevationArgs(port: number): string[] {
  const script = firewallScript(port);
  if (/['"`$;]/.test(script.replace(/\s&&?\s/g, ' '))) throw new Error('Unsafe firewall script');
  const command = `$p = Start-Process -FilePath cmd.exe -ArgumentList '/c ${script}' -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode`;
  return ['-NoProfile', '-NonInteractive', '-Command', command];
}

export type FirewallResult = { ok: true } | { ok: false; error: string; commands: string[] };

export function allowThroughFirewall(
  port: number,
  platform: NodeJS.Platform = process.platform,
): Promise<FirewallResult> {
  const commands = firewallCommands(port);
  if (platform !== 'win32')
    return Promise.resolve({
      ok: false,
      error: 'The firewall helper only works on Windows',
      commands,
    });
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    return Promise.resolve({ ok: false, error: 'Invalid port', commands });
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      elevationArgs(port),
      { windowsHide: true, timeout: 120_000 },
      (error) =>
        resolve(
          error
            ? {
                ok: false,
                error:
                  'Windows did not allow the change (the administrator prompt was cancelled or refused). Run the commands below as administrator instead.',
                commands,
              }
            : { ok: true },
        ),
    );
  });
}

/** IPv4 addresses of this PC on the LAN (private ranges first), for showing the server address. */
export function lanAddresses(
  interfaces: ReturnType<typeof networkInterfaces> = networkInterfaces(),
): string[] {
  const found: string[] = [];
  for (const list of Object.values(interfaces)) {
    for (const entry of list ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) found.push(entry.address);
    }
  }
  const isPrivate = (a: string): boolean => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a);
  return found.sort((a, b) => Number(isPrivate(b)) - Number(isPrivate(a)));
}
