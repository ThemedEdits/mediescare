import { uuidv7 } from 'uuidv7';

/** Time-ordered UUIDv7 primary key. Generated on the device that creates the row (CLAUDE.md §4.3). */
export function newId(): string {
  return uuidv7();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}
