import { hostname } from 'node:os';
import { DEFAULT_PORT, type RuntimeMode } from '@mediescare/config';
import { normaliseServerUrl, saveConfig, type DesktopConfig } from './config';
import type { DiscoveredServer } from './discovery';
import {
  DeviceTokenStore,
  pairWithServer,
  PairingFailedError,
  type PairedTerminal,
  type Sealer,
} from './pairing';

/** Machine readable failure kinds, so the wizard page can show the right bilingual text and hints. */
export type WizardErrorKind =
  'bad-address' | 'bad-code' | 'unreachable' | 'not-branch-server' | 'rate-limited' | 'other';

export type WizardResult<T = object> =
  ({ ok: true } & T) | { ok: false; kind: WizardErrorKind; error: string };

export interface WizardDeps {
  userData: string;
  sealer: Sealer;
  discover: () => Promise<DiscoveredServer[]>;
  /** Injectable for tests. Default: the real client. */
  pair?: typeof pairWithServer;
  fetch?: typeof fetch;
  /** The default LAN port of a branch server (for the firewall hint). */
  port?: number;
}

export const LOCAL_MODES: readonly RuntimeMode[] = ['single', 'branch-server'];

const fail = (
  kind: WizardErrorKind,
  error: string,
): { ok: false; kind: WizardErrorKind; error: string } => ({
  ok: false,
  kind,
  error,
});

/** Pairing codes are 8 digits, shown as 1234-5678. Spaces and dashes are ignored. */
export function normaliseCode(input: string): string | null {
  const digits = input.replace(/[\s-]/g, '');
  return /^[0-9]{8}$/.test(digits) ? digits : null;
}

/** The server needs 2 to 60 characters. Falls back to a fixed name when the PC name is unusable. */
export function cleanDeviceName(input: string): string {
  const name = [...input]
    .map((c) => (c.charCodeAt(0) < 32 ? ' ' : c))
    .join('')
    .trim()
    .slice(0, 60);
  return name.length >= 2 ? name : 'Counter';
}

/**
 * The logic behind the first-run wizard, without any Electron code so it can be tested with a
 * loopback server. The Electron layer (wizard-ipc.ts) only checks who is calling and closes the window.
 */
export function createWizardCore(deps: WizardDeps) {
  const doPair = deps.pair ?? pairWithServer;
  const tokens = new DeviceTokenStore(deps.userData, deps.sealer);

  return {
    defaultDeviceName: (): string => cleanDeviceName(hostname()),
    defaultPort: (): number => deps.port ?? DEFAULT_PORT,

    /** Servers answering on the LAN. Never throws: an empty list means "type the address". */
    async discover(): Promise<DiscoveredServer[]> {
      try {
        return await deps.discover();
      } catch {
        return [];
      }
    },

    /** Validate a typed address and check that something answers there (no secret is sent). */
    async checkAddress(input: string): Promise<WizardResult<{ url: string }>> {
      let url: string;
      try {
        url = normaliseServerUrl(String(input ?? ''));
      } catch (error) {
        return fail(
          'bad-address',
          error instanceof Error && !/Invalid URL/i.test(error.message)
            ? error.message
            : 'Enter the address like 192.168.1.10:3210',
        );
      }
      try {
        const res = await (deps.fetch ?? fetch)(`${url}/api/health`, {
          signal: AbortSignal.timeout(4000),
        });
        if (!res.ok) return fail('unreachable', `The address answered with HTTP ${res.status}`);
        const body = (await res.json().catch(() => null)) as { mode?: unknown } | null;
        if (body?.mode !== 'branch-server')
          return fail(
            'not-branch-server',
            'That PC is running Mediescare but not as a Branch Server',
          );
        return { ok: true, url };
      } catch {
        return fail('unreachable', 'Could not reach that address');
      }
    },

    /** Single PC or Branch Server: just remember the choice. */
    chooseLocal(mode: string): WizardResult<{ config: DesktopConfig }> {
      if (!(LOCAL_MODES as readonly string[]).includes(mode))
        return fail('other', 'Choose how this PC is used');
      const config: DesktopConfig = { mode: mode as RuntimeMode, port: DEFAULT_PORT };
      saveConfig(deps.userData, config);
      return { ok: true, config };
    },

    /**
     * Terminal: exchange the code for a device token, store the token sealed, and only then save
     * the config, so a failed pairing leaves nothing half configured.
     */
    async pairTerminal(request: {
      serverUrl: string;
      code: string;
      deviceName: string;
    }): Promise<WizardResult<{ config: DesktopConfig; deviceId: string; branchCode: string }>> {
      let serverUrl: string;
      try {
        serverUrl = normaliseServerUrl(String(request?.serverUrl ?? ''));
      } catch {
        return fail('bad-address', 'Enter the address like 192.168.1.10:3210');
      }
      const code = normaliseCode(String(request?.code ?? ''));
      if (!code) return fail('bad-code', 'The pairing code has 8 digits, for example 4821-9037');
      let paired: PairedTerminal;
      try {
        paired = await doPair({
          serverUrl,
          code,
          deviceName: cleanDeviceName(String(request?.deviceName ?? '')),
          fetch: deps.fetch,
        });
      } catch (error) {
        if (error instanceof PairingFailedError) {
          if (error.status === null) return fail('unreachable', error.message);
          if (error.status === 403) return fail('bad-code', error.message);
          if (error.status === 429) return fail('rate-limited', error.message);
          if (error.status === 404)
            return fail('not-branch-server', 'That PC is not running as a Branch Server');
        }
        return fail('other', error instanceof Error ? error.message : 'Pairing failed');
      }
      try {
        tokens.save('terminal', paired.token);
        const config: DesktopConfig = { mode: 'terminal', serverUrl, port: DEFAULT_PORT };
        saveConfig(deps.userData, config);
        return { ok: true, config, deviceId: paired.deviceId, branchCode: paired.branchCode };
      } catch {
        return fail('other', 'Paired, but this PC could not save the settings. Try again.');
      }
    },
  };
}

export type WizardCore = ReturnType<typeof createWizardCore>;
