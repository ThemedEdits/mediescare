/** True when the page asking to print is the app itself, not a frame from some other origin. */
export function isAllowedSender(frameUrl: string | undefined | null, appOrigin: string): boolean {
  if (!frameUrl) return false;
  try {
    return new URL(frameUrl).origin === new URL(appOrigin).origin;
  } catch {
    return false;
  }
}

/** A safe .pdf file name for the save dialog, whatever the page suggested. */
export function pdfFileName(suggested: unknown): string {
  const raw = typeof suggested === 'string' ? suggested : '';
  const cleaned = raw
    .replace(/\.pdf$/i, '')
    // eslint-disable-next-line no-control-regex -- control characters are not allowed in file names
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .trim()
    .slice(0, 120);
  return `${cleaned || 'report'}.pdf`;
}
