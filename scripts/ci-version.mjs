// CI release version: keeps major.minor from apps/desktop/package.json and uses the GitHub Actions
// run number as the patch, so every push to main gets a higher version than the one installed.
// Bump major or minor in package.json by hand for bigger releases. Prints the version it set.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'desktop', 'package.json');
const run = Number.parseInt(process.env.GITHUB_RUN_NUMBER ?? '', 10);
if (!Number.isInteger(run) || run < 1) {
  console.error('GITHUB_RUN_NUMBER is missing: this script is for CI only');
  process.exit(1);
}
const pkg = JSON.parse(readFileSync(file, 'utf8'));
const [major, minor] = String(pkg.version).split('.');
pkg.version = `${major}.${minor}.${run}`;
writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(pkg.version);
