// Generates the Windows .ico and PNG icons from docs/branding/mediescare-icon.svg.
// Run automatically by `pnpm build` in apps/desktop. Output goes to build/icons (git-ignored).
import * as canvas from '@napi-rs/canvas';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'build/icons');
mkdirSync(out, { recursive: true });

// The SVG colours its shapes with CSS classes, which the rasteriser ignores. Inline them first.
let svg = readFileSync(join(root, '../../docs/branding/mediescare-icon.svg'), 'utf8');
const fills = new Map([...svg.matchAll(/\.(\w+)\s*\{\s*fill:\s*(#[0-9a-fA-F]{3,8})/g)].map((m) => [m[1], m[2]]));
for (const [cls, colour] of fills) svg = svg.replaceAll(`class="${cls}"`, `fill="${colour}"`);
const image = await canvas.loadImage(Buffer.from(svg));

/** Render the (slightly non-square) logo centred on a transparent square of the given size. */
function renderPng(size) {
  const c = canvas.createCanvas(size, size);
  const ctx = c.getContext('2d');
  const scale = (size * 0.92) / Math.max(image.width, image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  ctx.drawImage(image, (size - w) / 2, (size - h) / 2, w, h);
  return c.toBuffer('image/png');
}

const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = sizes.map((s) => ({ size: s, data: renderPng(s) }));
writeFileSync(join(out, 'icon.png'), renderPng(512));

// ICO container with PNG-compressed entries (supported by Windows Vista and later).
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(pngs.length, 4);
const entries = Buffer.alloc(16 * pngs.length);
let offset = header.length + entries.length;
pngs.forEach(({ size, data }, i) => {
  const e = i * 16;
  entries[e] = size === 256 ? 0 : size;
  entries[e + 1] = size === 256 ? 0 : size;
  entries.writeUInt16LE(1, e + 4); // colour planes
  entries.writeUInt16LE(32, e + 6); // bits per pixel
  entries.writeUInt32LE(data.length, e + 8);
  entries.writeUInt32LE(offset, e + 12);
  offset += data.length;
});
writeFileSync(join(out, 'icon.ico'), Buffer.concat([header, entries, ...pngs.map((p) => p.data)]));
console.log(`Icons written to ${out}`);
