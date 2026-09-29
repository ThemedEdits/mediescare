import { join } from 'node:path';
import { app } from 'electron';

/** Root of the copied Next.js standalone output (see scripts/prepare-web.mjs). */
export function webRoot(): string {
  return app.isPackaged ? join(process.resourcesPath, 'web') : join(__dirname, '..', 'build', 'web');
}

export const serverJs = (): string => join(webRoot(), 'apps', 'web', 'server.js');
export const migrationsDir = (): string => join(webRoot(), 'packages', 'db', 'migrations', 'sqlite');
export const resourcePath = (name: string): string =>
  app.isPackaged ? join(process.resourcesPath, name) : join(__dirname, '..', 'resources', name);
export const preloadPath = (): string => join(__dirname, 'preload.cjs');
export const iconPath = (): string =>
  app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(__dirname, '..', 'build', 'icons', 'icon.png');
