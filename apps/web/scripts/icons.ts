/** Rasterizes the brand icon into the PWA / favicon set (public/icons). */
import { readFileSync } from 'node:fs';

import { LOGO_SHAPES } from '@reilai/brand';
import sharp from 'sharp';

const icon = readFileSync(new URL('../../../packages/brand/icon.svg', import.meta.url));
const out = new URL('../public/icons/', import.meta.url).pathname;

// maskable: full-bleed background, mark inside the 80% safe zone
const s = 1024;
const scale = (0.46 * s) / 886;
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7467C7"/><stop offset="1" stop-color="#4A3F94"/></linearGradient></defs>
<rect width="${s}" height="${s}" fill="url(#g)"/>
<g transform="translate(${(s - 770 * scale) / 2} ${(s - 886 * scale) / 2}) scale(${scale})" fill="#fff" stroke="#fff" stroke-width="3" stroke-linejoin="round">${LOGO_SHAPES}</g></svg>`;

await Promise.all([
  sharp(icon).resize(192, 192).png().toFile(`${out}icon-192.png`),
  sharp(icon).resize(512, 512).png().toFile(`${out}icon-512.png`),
  sharp(Buffer.from(maskable)).resize(512, 512).png().toFile(`${out}maskable-512.png`),
  sharp(Buffer.from(maskable)).resize(180, 180).png().toFile(`${out}apple-touch-icon.png`),
  sharp(icon).resize(64, 64).png().toFile(`${out}favicon-64.png`),
]);
await Bun.write(`${out}favicon.svg`, icon);
console.log('icons written to', out);
