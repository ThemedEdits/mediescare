import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const apiDir = join(__dirname, 'app', 'api');

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? routeFiles(full) : name === 'route.ts' ? [full] : [];
  });
}

/** Routes that are intentionally reachable without a permission. Adding one here needs a review. */
const OPEN_ROUTES = new Set(['health', 'setup', 'auth/login', 'auth/logout', 'me']);

describe('API routes are guarded (CLAUDE.md §4.2: authorize every action)', () => {
  const files = routeFiles(apiDir);

  it('finds the routes', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const name = relative(apiDir, file).replace(/\\/g, '/').replace(/\/route\.ts$/, '');
    const source = readFileSync(file, 'utf8');

    it(`${name} declares its access rule`, () => {
      if (OPEN_ROUTES.has(name)) {
        expect(source).toMatch(/publicRoute\(/);
      } else {
        expect(source, 'protected routes must use withPermission(<permission>, ...)').toMatch(/withPermission\('[a-z_]+\.[a-z_]+\.[a-z_]+'/);
      }
    });

    it(`${name} does not read the request body without validation`, () => {
      if (/request\.json\(\)/.test(source)) expect(source).toMatch(/\.parse\(/);
    });
  }

  it('every open route is really in the allowlist (no stale entries)', () => {
    const names = files.map((f) => relative(apiDir, f).replace(/\\/g, '/').replace(/\/route\.ts$/, ''));
    for (const open of OPEN_ROUTES) expect(names).toContain(open);
  });
});
