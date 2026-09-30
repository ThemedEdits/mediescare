import { z } from 'zod';
import { SYNC_OPS } from '@mediescare/sync';

/** Wire format of `/api/sync/push` and `/api/sync/pull` (validated on the cloud side, CLAUDE.md §8). */
const ident = z.string().min(1).max(64);
/** Composite keys such as `branchId:settingKey` or `userId:roleId` are longer than a UUID. */
const entityKey = z.string().min(1).max(200);
const entityType = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/)
  .max(64);

export const SyncEventSchema = z.object({
  id: ident,
  seq: z.number().int().nonnegative().safe(),
  entityType,
  entityId: entityKey,
  op: z.enum(SYNC_OPS),
  payload: z.unknown(),
  hlc: z.string().regex(/^[0-9a-f]{12}-[0-9a-f]{4}-[0-9a-f]{8}$/),
  deviceId: ident,
  branchId: ident.nullable(),
  tenantId: ident,
  schemaVersion: z.number().int().positive().max(1000),
});

export const PushBodySchema = z.object({
  idempotencyKey: z.string().min(1).max(100),
  epoch: z.number().int().min(1).max(1_000_000),
  events: z.array(SyncEventSchema).max(500),
});

export const PullBodySchema = z.object({
  cursors: z
    .record(entityType, z.string().regex(/^[0-9]{1,15}$/))
    .refine((c) => Object.keys(c).length <= 40, 'too many entity types'),
  limit: z.number().int().min(1).max(500),
});

export const PairBodySchema = z.object({
  code: z.string().trim().min(8).max(12),
  deviceName: z.string().trim().min(2).max(60),
});

/** Largest push or pull body accepted, in characters. Bigger batches are refused before parsing. */
export const MAX_SYNC_BODY_CHARS = 5_000_000;

/** Ids a database that already exists asks the cloud to adopt (UUIDs or similar, no punctuation). */
const adoptId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
const branchCode = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(/^[A-Za-z0-9_-]+$/);
const displayName = z.string().trim().min(2).max(100);

export const BootstrapBodySchema = z.object({
  bootstrapCode: z.string().trim().min(1).max(200),
  organisationName: displayName,
  branchCode,
  branchName: displayName,
  deviceName: z.string().trim().min(2).max(60),
  identity: z
    .object({
      tenantId: adoptId.optional(),
      branchId: adoptId.optional(),
      deviceId: adoptId.optional(),
    })
    .optional(),
});

export const EnrollBodySchema = z.object({
  code: z.string().trim().min(8).max(40),
  deviceName: z.string().trim().min(2).max(60),
  identity: z.object({ branchId: adoptId.optional(), deviceId: adoptId.optional() }).optional(),
});

export const TokenBodySchema = z.object({ refreshToken: z.string().min(20).max(300) });

export const EnrollmentCodeBodySchema = z.object({
  branchCode,
  branchName: displayName,
  branchId: adoptId.optional(),
});

/** Bodies of the device endpoints are small; anything bigger is refused before parsing. */
export const MAX_DEVICE_BODY_CHARS = 10_000;

/** Body of POST /api/sync/connect (Head Office PC, admin screen). */
export const ConnectBodySchema = z.object({
  cloudUrl: z.string().trim().min(8).max(300),
  bootstrapCode: z.string().trim().min(1).max(200),
  organisationName: displayName,
});
