// electron-builder never copies folders named node_modules from `extraResources`.
// The Next.js standalone server needs its node_modules next to server.js, so copy them explicitly.
// Found by the packaged-app smoke test ("Cannot find module 'next'"), see ADR-0007.
const { cpSync, existsSync } = require('node:fs');
const { join } = require('node:path');

exports.default = async function afterPack(context) {
  const source = join(__dirname, '..', 'build', 'web', 'node_modules');
  const target = join(context.appOutDir, 'resources', 'web', 'node_modules');
  if (!existsSync(source)) throw new Error(`afterPack: ${source} is missing. Run prepare-web first.`);
  cpSync(source, target, { recursive: true, dereference: true });
  console.log(`  • afterPack: copied web node_modules -> ${target}`);
};
