import { runCloudStoreContract, type ContractHarness } from './cloud-store-contract';
import { InMemoryCloudStore, type DeviceAuth } from './cloud-store';

runCloudStoreContract('in-memory', async (now) => {
  const store = new InMemoryCloudStore({ now });
  const tokens = new Map<string, string>();
  const key = (a: DeviceAuth) => `${a.tenantId}|${a.deviceId}`;
  const harness: ContractHarness = {
    store,
    register(auth) {
      const token = tokens.get(key(auth)) ?? `token-${tokens.size}-0123456789`;
      tokens.set(key(auth), token);
      store.registerDevice(token, auth);
      return Promise.resolve(token);
    },
    revoke(auth) {
      store.revokeDevice(tokens.get(key(auth)) as string);
      return Promise.resolve();
    },
    epochOf: (auth) => Promise.resolve(store.epochOf(auth)),
    countEvents: () => Promise.resolve(store.appliedIds.length),
    master(entityType, entityId) {
      const m = store.master(entityType, entityId);
      return Promise.resolve(m ? { fields: m.fields, version: m.version, voided: m.voided } : null);
    },
    conflicts: () => Promise.resolve(store.conflicts),
    close: () => Promise.resolve(),
  };
  return harness;
});
