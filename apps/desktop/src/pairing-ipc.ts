import { ipcMain, safeStorage } from 'electron';
import { discoverServers, type DiscoveredServer } from './discovery';
import { DeviceTokenStore, pairWithServer, type Sealer } from './pairing';

/** Seals device tokens with the OS credential store (Windows DPAPI), like the database key. */
export const electronSealer: Sealer = {
  seal: (plain) => safeStorage.encryptString(plain).toString('base64'),
  unseal: (blob) => safeStorage.decryptString(Buffer.from(blob, 'base64')),
};

/**
 * IPC for the (future) terminal pairing screen: find servers on the LAN and pair with a code.
 * Only pages served by the app's own origin may call it. The token never reaches the page: it is
 * stored sealed in the user data folder and only its device id is returned.
 */
export function registerPairingHandlers(userData: string, origin: string): DeviceTokenStore {
  const tokens = new DeviceTokenStore(userData, electronSealer);
  const trusted = (url: string | undefined): boolean => {
    try {
      return new URL(url ?? '').origin === origin;
    } catch {
      return false;
    }
  };
  ipcMain.handle('lan:discover', async (event): Promise<DiscoveredServer[]> => {
    if (!trusted(event.senderFrame?.url)) return [];
    return discoverServers();
  });
  ipcMain.handle(
    'lan:pair',
    async (
      event,
      request: { serverUrl: string; code: string; deviceName: string },
    ): Promise<{ ok: boolean; deviceId?: string; error?: string }> => {
      if (!trusted(event.senderFrame?.url)) return { ok: false, error: 'Unexpected sender' };
      try {
        const paired = await pairWithServer(request);
        tokens.save('terminal', paired.token);
        return { ok: true, deviceId: paired.deviceId };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Pairing failed' };
      }
    },
  );
  return tokens;
}
