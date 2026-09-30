import { describe, expect, it } from 'vitest';
import {
  CloudDatabaseAuthError,
  CloudDatabaseUnreachableError,
  createPostgresClient,
  scrubSecrets,
  translateDbError,
} from './sql-client';

describe('database errors', () => {
  it('explains the IPv6-only Supabase direct host and points to the Session pooler', () => {
    const err = translateDbError(
      Object.assign(new Error('connect ENETUNREACH 2a05:d018::1:5432'), { code: 'ENETUNREACH' }),
      'db.abcdefghijklmnop.supabase.co',
    );
    expect(err).toBeInstanceOf(CloudDatabaseUnreachableError);
    expect(err.message).toMatch(/Session pooler/);
    expect(err.message).toMatch(/Connect > Session pooler/);
    expect(err.message).toMatch(/IPv6/);
    expect(err.message).toMatch(/db\.abcdefghijklmnop\.supabase\.co/);
  });

  it('maps a refused login without echoing anything', () => {
    const err = translateDbError(
      Object.assign(new Error('password authentication failed for user "postgres"'), {
        code: '28P01',
      }),
      'h',
    );
    expect(err).toBeInstanceOf(CloudDatabaseAuthError);
  });

  it('scrubs passwords and tokens from text', () => {
    const text =
      'failed postgres://postgres:Sup3rSecret@db.example.test:5432/postgres token=abc123 password=xyz';
    const clean = scrubSecrets(text);
    expect(clean).not.toMatch(/Sup3rSecret|abc123|xyz/);
  });

  it('an unreachable host gives a friendly error that never contains the password', async () => {
    // Port 1 on loopback refuses at once, so this works offline and fast.
    const client = await createPostgresClient(
      'postgres://postgres:Sup3rSecret@127.0.0.1:1/postgres',
      {
        max: 1,
        connectTimeoutSeconds: 2,
      },
    );
    const failure = await client.query('SELECT 1').then(
      () => null,
      (e: unknown) => e as Error,
    );
    await client.close().catch(() => undefined);
    expect(failure).toBeInstanceOf(CloudDatabaseUnreachableError);
    expect(failure?.message).toMatch(/Session pooler/);
    expect(failure?.message).not.toMatch(/Sup3rSecret/);
  });
});
