import { APP_NAME } from '@mediescare/config';
import { isCloudMode } from '@/server/sync-cloud-context';
import { json, publicRoute } from '@/server/sync-http';

export const dynamic = 'force-dynamic';

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${APP_NAME} cloud</title>
<style>body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#fff;color:#222}
main{max-width:28rem;padding:1.5rem;text-align:center}h1{font-size:1.25rem}p{color:#555;line-height:1.5}</style></head>
<body><main><h1>${APP_NAME} cloud sync endpoint</h1>
<p>This address is used by ${APP_NAME} branch computers to synchronise. There is nothing to see here.</p></main></body></html>`;

/** Landing page of a cloud-mode deployment (served as / there). Static text, no data. */
export const GET = publicRoute(() =>
  isCloudMode()
    ? new Response(PAGE, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      })
    : json({ error: { code: 'NOT_CLOUD_MODE' } }, 404),
);
