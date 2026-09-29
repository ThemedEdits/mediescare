import { hash, verify } from '@node-rs/argon2';

/**
 * argon2id with the library defaults (19 MiB, 2 iterations, 1 lane), matching ADR-0003.
 * Tuning to 150-300 ms on the 4 GB reference PC is a Phase 1 measurement task.
 */
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false; // malformed hash: treat as a failed login, never crash
  }
}

// A short offline list. The full breached-password list is bundled in a later task (ADR-0003 §1).
const COMMON = new Set([
  'password', 'password1', 'password123', '1234567890', '12345678910', 'qwertyuiop', 'iloveyou12',
  'admin12345', 'welcome123', 'letmein123', 'pakistan123', 'karachi123', 'mediescare',
]);

export interface PolicyResult {
  ok: boolean;
  problems: string[];
}

export const MIN_PASSWORD_LENGTH = 10;

export function checkPasswordPolicy(password: string, username?: string): PolicyResult {
  const problems: string[] = [];
  if (password.length < MIN_PASSWORD_LENGTH) problems.push(`Use at least ${MIN_PASSWORD_LENGTH} characters`);
  if (COMMON.has(password.toLowerCase())) problems.push('This password is too common');
  if (username && username.length >= 3 && password.toLowerCase().includes(username.toLowerCase())) {
    problems.push('Password must not contain the username');
  }
  if (/^(.)\1+$/.test(password)) problems.push('Password must not be one repeated character');
  return { ok: problems.length === 0, problems };
}
