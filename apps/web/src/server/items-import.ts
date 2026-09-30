import { z } from 'zod';
import {
  IMPORT_FIELD_INFO,
  IMPORT_FIELDS,
  MAX_IMPORT_BYTES,
  type ColumnMapping,
  type ImportJob,
} from '@mediescare/db';

/** Mapping as sent by the browser: field to column number, or null for "do not import". */
export const MappingBody = z.partialRecord(
  z.enum(IMPORT_FIELDS),
  z.number().int().min(0).max(99).nullable(),
);

export const OptionsBody = z.object({ importStock: z.boolean().default(false) });

export function toMapping(input: z.infer<typeof MappingBody>): ColumnMapping {
  const mapping: ColumnMapping = {};
  for (const field of IMPORT_FIELDS) {
    const index = input[field];
    if (index !== undefined && index !== null) mapping[field] = index;
  }
  return mapping;
}

export const MAX_UPLOAD_BYTES = MAX_IMPORT_BYTES;

/** Fields the mapping screen shows (the synonym lists stay on the server). */
export const FIELD_CHOICES = IMPORT_FIELD_INFO.map(({ key, label, required, hint }) => ({
  key,
  label,
  required,
  hint,
}));

/** What the browser needs to draw the review step and the progress bar. */
export function jobView(job: ImportJob, issueLimit = 100) {
  const { issues, ...summary } = job.report;
  return {
    importId: job.id,
    fileName: job.fileName,
    status: job.status,
    headers: job.headers,
    mapping: job.mapping,
    fields: FIELD_CHOICES,
    summary: {
      ...summary,
      issueCounts: job.report.issueCounts,
      storedIssues: issues.length,
    },
    needsDefaultExpiry: job.report.needsDefaultExpiry > 0,
    sampleIssues: issues.slice(0, issueLimit),
    progress: job.progress,
    result: job.result,
    error: job.error,
  };
}
