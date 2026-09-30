import { z } from 'zod';
import { createPreviewJob, DomainError, parseItemFile } from '@mediescare/db';
import { json, withPermission } from '@/server/guard';
import {
  jobView,
  MAX_UPLOAD_BYTES,
  MappingBody,
  OptionsBody,
  toMapping,
} from '@/server/items-import';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const Form = z.object({
  file: z.instanceof(File),
  mapping: z.string().max(4000).optional(),
  options: z.string().max(1000).optional(),
});

/** Parse a JSON form field with its schema. A bad value is the caller's mistake, not a server error. */
function field<T>(schema: z.ZodType<T>, text: string | undefined): T | undefined {
  if (text === undefined || text === '') return undefined;
  try {
    return schema.parse(JSON.parse(text));
  } catch {
    throw new DomainError('INVALID', 'The mapping or options sent with the file are not valid');
  }
}

/** Upload an .xlsx or .csv, detect the columns and validate every row (dry run, nothing is written). */
export const POST = withPermission('pharmacy.item.import', async (request, auth) => {
  const data = await request.formData();
  const form = Form.parse({
    file: data.get('file'),
    mapping: data.get('mapping') ?? undefined,
    options: data.get('options') ?? undefined,
  });
  if (form.file.size > MAX_UPLOAD_BYTES)
    throw new DomainError('INVALID', 'The file is larger than 25 MB');
  const mapping = field(MappingBody, form.mapping);
  const options = field(OptionsBody, form.options) ?? { importStock: false };

  const table = await parseItemFile(Buffer.from(await form.file.arrayBuffer()), form.file.name);
  const job = createPreviewJob(
    getDb(),
    writeContext(auth.userId),
    table,
    mapping ? toMapping(mapping) : null,
    options,
  );
  return json(jobView(job), 201);
});
