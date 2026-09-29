import { APP_NAME } from '@mediescare/config';
import { getRuntime, initialized } from '@/server/runtime';
import { json, publicRoute } from '@/server/guard';

export const dynamic = 'force-dynamic';

/** Liveness probe used by the desktop shell and terminals. Reveals nothing sensitive. */
export const GET = publicRoute(() => {
  const runtime = getRuntime();
  return json({
    status: 'ok',
    app: APP_NAME,
    mode: runtime.mode,
    initialized: initialized(),
    time: new Date().toISOString(),
  });
});
