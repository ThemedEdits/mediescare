import { describe, expect, it } from 'vitest';
import { isAllowedSender, pdfFileName } from './print-guard';

describe('print guard', () => {
  it('allows only the app origin', () => {
    expect(isAllowedSender('http://127.0.0.1:3210/reports', 'http://127.0.0.1:3210')).toBe(true);
    expect(isAllowedSender('http://127.0.0.1:3211/reports', 'http://127.0.0.1:3210')).toBe(false);
    expect(isAllowedSender('https://evil.example/', 'http://127.0.0.1:3210')).toBe(false);
    expect(isAllowedSender('http://127.0.0.1:3210.evil.example/', 'http://127.0.0.1:3210')).toBe(
      false,
    );
    expect(isAllowedSender(undefined, 'http://127.0.0.1:3210')).toBe(false);
    expect(isAllowedSender('not a url', 'http://127.0.0.1:3210')).toBe(false);
  });

  it('makes a safe pdf name', () => {
    expect(pdfFileName('mediescare-sales-daily-2026-10-05')).toBe(
      'mediescare-sales-daily-2026-10-05.pdf',
    );
    expect(pdfFileName('a/b\\c:d.pdf')).toBe('a-b-c-d.pdf');
    expect(pdfFileName(42)).toBe('report.pdf');
    expect(pdfFileName('  ')).toBe('report.pdf');
  });
});
