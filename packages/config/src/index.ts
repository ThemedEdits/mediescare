/** Product identity. The single source for the product name (owner confirmed "Mediescare"). */
export const APP_NAME = 'Mediescare';
export const APP_ID = 'com.mediescare.app';

/** Runtime modes, selected with MEDIESCARE_MODE (CLAUDE.md §4.1). */
export const RUNTIME_MODES = ['single', 'branch-server', 'terminal', 'cloud'] as const;
export type RuntimeMode = (typeof RUNTIME_MODES)[number];

export function parseRuntimeMode(value: string | undefined): RuntimeMode {
  const mode = (value ?? 'single').trim();
  if ((RUNTIME_MODES as readonly string[]).includes(mode)) return mode as RuntimeMode;
  throw new Error(`Invalid MEDIESCARE_MODE "${mode}". Expected one of: ${RUNTIME_MODES.join(', ')}`);
}

export const DEFAULT_PORT = 3210;

/**
 * Brand colours measured from docs/branding/mediescare-logo.svg (see docs/phase0/style-guide.md).
 * Only these two hexes come from the logo. Everything else in tokens.css is derived from them.
 */
export const BRAND = {
  primary: '#3DA6DD',
  secondary: '#8FC33E',
} as const;
