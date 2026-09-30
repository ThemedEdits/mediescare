-- Mediescare cloud sync store (PostgreSQL). Applied by `pnpm cloud:migrate` (packages/db/src/cli/cloud-migrate.ts).
-- These tables exist ONLY in the cloud database. They are plain SQL, not Drizzle tables, and are
-- deliberately outside the SQLite/PostgreSQL parity test. All ids are text (UUIDs from the branches).
-- Forward-only: never edit this file after it was applied anywhere; add 002_*.sql instead.

CREATE TABLE tenants (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  -- Lower-cased, trimmed name: bootstrap works once per organisation name.
  name_key    text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Branch registry (who exists in the cloud). Not the synced `branches` business table.
CREATE TABLE branches (
  id              text PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenants (id),
  code            text NOT NULL,
  name            text NOT NULL,
  is_head_office  boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
CREATE UNIQUE INDEX branches_one_head_office ON branches (tenant_id) WHERE is_head_office;

-- One row per enrolled branch server. Refresh tokens are stored only as SHA-256 hashes.
-- `refresh_used` holds the hashes of the most recent tokens that were already replaced (newest first,
-- at most 20): presenting one again means the token was copied, so the device is revoked.
CREATE TABLE devices (
  id                 text PRIMARY KEY,
  tenant_id          text NOT NULL REFERENCES tenants (id),
  branch_id          text NOT NULL REFERENCES branches (id),
  name               text NOT NULL,
  refresh_hash       text NOT NULL,
  refresh_used       text[] NOT NULL DEFAULT '{}',
  refreshed_at       timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  revoked_at         timestamptz,
  last_seen_at       timestamptz
);
CREATE INDEX devices_branch ON devices (tenant_id, branch_id);

-- One-time codes that let a new branch enrol (created by a Head Office device, valid 24 hours).
CREATE TABLE enrollment_codes (
  code_hash          text PRIMARY KEY,
  tenant_id          text NOT NULL REFERENCES tenants (id),
  branch_code        text NOT NULL,
  branch_name        text NOT NULL,
  -- Id the new branch must get. Head Office creates the branch row locally with this id and announces it,
  -- so the cloud registry must use the same one. NULL: the cloud generates an id.
  branch_id          text,
  is_head_office     boolean NOT NULL DEFAULT false,
  created_by_device  text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  used_at            timestamptz,
  used_by_device     text
);
CREATE INDEX enrollment_codes_expiry ON enrollment_codes (expires_at);

-- Append-only change log. `seq` is the pull cursor: it is handed out while the tenant advisory
-- lock is held, so commit order equals seq order and a puller can never skip a row.
CREATE TABLE sync_events (
  seq             bigserial PRIMARY KEY,
  event_id        text NOT NULL,
  tenant_id       text NOT NULL,
  branch_id       text,
  device_id       text NOT NULL,
  entity_type     text NOT NULL,
  entity_id       text NOT NULL,
  op              text NOT NULL,
  payload         jsonb NOT NULL,
  hlc             text NOT NULL,
  schema_version  integer NOT NULL,
  client_seq      bigint NOT NULL DEFAULT 0,
  epoch           integer NOT NULL,
  -- Master data: version of the entity after this event. Documents: NULL.
  version         integer,
  flags           text,
  -- Copied out of the payload so "addressed to this branch" is an index lookup.
  to_branch_id    text,
  from_branch_id  text,
  received_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, event_id)
);
CREATE INDEX sync_events_pull ON sync_events (tenant_id, entity_type, seq);
CREATE INDEX sync_events_received ON sync_events (received_at);

-- Latest merged state of every master-data entity (the merge input for the next event).
CREATE TABLE entity_heads (
  tenant_id    text NOT NULL,
  entity_type  text NOT NULL,
  entity_id    text NOT NULL,
  version      integer NOT NULL,
  record       jsonb NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, entity_type, entity_id)
);

-- One row per push batch key, for monitoring and safe compaction. Idempotency itself is per event id.
CREATE TABLE push_batches (
  tenant_id        text NOT NULL,
  branch_id        text NOT NULL,
  idempotency_key  text NOT NULL,
  event_count      integer NOT NULL,
  attempts         integer NOT NULL DEFAULT 1,
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, branch_id, idempotency_key)
);

-- Highest server epoch per branch (failover fencing, ADR-0004). The row is locked FOR UPDATE by every push.
CREATE TABLE epochs (
  tenant_id   text NOT NULL,
  branch_id   text NOT NULL,
  epoch       integer NOT NULL DEFAULT 1,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, branch_id)
);

-- Field conflicts found by the master-data merge (both values kept for the review screen).
CREATE TABLE sync_conflicts (
  id           bigserial PRIMARY KEY,
  tenant_id    text NOT NULL,
  entity_type  text NOT NULL,
  entity_id    text NOT NULL,
  field        text NOT NULL,
  reason       text NOT NULL,
  winner       jsonb NOT NULL,
  loser        jsonb NOT NULL,
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sync_conflicts_entity ON sync_conflicts (tenant_id, entity_type, entity_id);
