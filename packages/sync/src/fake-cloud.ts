import { InMemoryCloudStore, type DeviceAuth, type InMemoryStoreOptions } from './cloud-store';
import {
  CloudAuthError,
  type CloudAdapter,
  type PullRequest,
  type PullResponse,
  type PushRequest,
  type PushResponse,
} from './outbox';

/** Failures a test can switch on for one device connection. */
export interface FakeFaults {
  /** Every call throws like a dead network. */
  offline: boolean;
  /** The next N pushes are applied by the cloud, then the response is lost (timeout after apply). */
  loseNextResponses: number;
  /** The next push applies only this many events, then the connection drops. One shot. */
  dropAfterEvents: number | null;
  /** Deliver each batch in reverse order (out-of-order delivery). */
  reverseBatches: boolean;
  /** The network delivers each push twice (a retry the sender never saw). */
  deliverTwice: boolean;
  /** The token was revoked (stolen device). */
  revoked: boolean;
}

/**
 * In-memory stand-in for the cloud, for tests only. It wraps an `InMemoryCloudStore` (the real
 * cloud rules) and hands out one `CloudAdapter` per device with switchable network faults.
 * Nothing here talks to a network or to Supabase: it proves the branch side and the rules,
 * not a real deployment.
 */
export class FakeCloud {
  readonly store: InMemoryCloudStore;

  constructor(options: InMemoryStoreOptions = {}) {
    this.store = new InMemoryCloudStore(options);
  }

  connect(auth: DeviceAuth): FakeConnection {
    return new FakeConnection(this.store, auth);
  }
}

export class FakeConnection implements CloudAdapter {
  readonly faults: FakeFaults = {
    offline: false,
    loseNextResponses: 0,
    dropAfterEvents: null,
    reverseBatches: false,
    deliverTwice: false,
    revoked: false,
  };
  /** Every push request that reached (or would have reached) the cloud, for assertions. */
  readonly pushes: PushRequest[] = [];
  pulls = 0;

  constructor(
    private readonly store: InMemoryCloudStore,
    private readonly auth: DeviceAuth,
  ) {}

  private gate(): void {
    if (this.faults.offline) throw new Error('ECONNREFUSED (fake network is offline)');
    if (this.faults.revoked) throw new CloudAuthError();
  }

  async push(request: PushRequest): Promise<PushResponse> {
    this.gate();
    this.pushes.push(request);
    const sent: PushRequest = this.faults.reverseBatches
      ? { ...request, events: [...request.events].reverse() }
      : request;

    if (this.faults.dropAfterEvents !== null) {
      const n = this.faults.dropAfterEvents;
      this.faults.dropAfterEvents = null;
      await this.store.applyBatch(this.auth, { ...sent, events: sent.events.slice(0, n) });
      throw new Error('ECONNRESET (fake connection dropped mid-batch)');
    }

    const first = await this.store.applyBatch(this.auth, sent);
    if (this.faults.deliverTwice) await this.store.applyBatch(this.auth, sent);
    if (this.faults.loseNextResponses > 0) {
      this.faults.loseNextResponses -= 1;
      throw new Error('ETIMEDOUT (fake response lost after the cloud applied the batch)');
    }
    return first;
  }

  async pull(request: PullRequest): Promise<PullResponse> {
    this.gate();
    this.pulls += 1;
    return this.store.pull(this.auth, request);
  }
}
