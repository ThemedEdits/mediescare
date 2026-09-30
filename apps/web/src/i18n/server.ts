import { cache } from 'react';
import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { schema, SESSION_COOKIE, verifySessionToken } from '@mediescare/db';
import { getDb, getSessionSecret, initialized } from '@/server/runtime';
import {
  createTranslator,
  dirOf,
  LOCALE_COOKIE,
  resolveLocale,
  type Locale,
  type Translator,
} from './core';
import { messagesFor } from './messages';

/** Language stored on the signed-in user, or null when nobody is signed in. Read-only: does not touch the session. */
async function signedInLanguage(): Promise<string | null> {
  try {
    if (!initialized()) return null;
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!token) return null;
    const claims = await verifySessionToken(token, getSessionSecret());
    if (!claims) return null;
    const row = getDb()
      .select({ language: schema.users.language })
      .from(schema.users)
      .where(eq(schema.users.id, claims.uid))
      .get();
    return row?.language ?? null;
  } catch {
    return null;
  }
}

/** Current locale: signed-in user, then cookie, then English. Cached for the duration of one request. */
export const getLocale = cache(async (): Promise<Locale> => {
  const userLanguage = await signedInLanguage();
  const cookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  return resolveLocale({ userLanguage, cookie });
});

/** Translator for server components: `const { t } = await getT();` */
export async function getT(): Promise<{ t: Translator; locale: Locale; dir: 'ltr' | 'rtl' }> {
  const locale = await getLocale();
  return {
    t: createTranslator(messagesFor(locale), process.env.NODE_ENV === 'production'),
    locale,
    dir: dirOf(locale),
  };
}
