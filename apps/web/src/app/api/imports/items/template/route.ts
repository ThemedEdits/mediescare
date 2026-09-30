import { buildItemTemplate } from '@mediescare/db';
import { withPermission } from '@/server/guard';

export const dynamic = 'force-dynamic';

/** Starter spreadsheet with the headers Mediescare understands and three fake example rows. */
export const GET = withPermission('pharmacy.item.import', async () => {
  const file = await buildItemTemplate();
  return new Response(new Uint8Array(file), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="mediescare-items-template.xlsx"',
      'Cache-Control': 'no-store',
    },
  });
});
