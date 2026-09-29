import type { HybridLogicalClock } from '@mediescare/sync';

/** Identity of the actor and place of every write. Built by the server from the session. */
export interface WriteContext {
  tenantId: string;
  branchId: string;
  deviceId: string;
  userId: string | null;
  clock: HybridLogicalClock;
  /** Injectable for tests. */
  now?: () => Date;
}

export function isoNow(ctx: Pick<WriteContext, 'now'>): string {
  return (ctx.now ? ctx.now() : new Date()).toISOString();
}
