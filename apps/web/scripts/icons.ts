/** Rasterizes the app icon into the PWA / favicon set (public/icons). */
import { appIconMarkup } from '@reilai/brand';
import sharp from 'sharp';

const out = new URL('../public/icons/', import.meta.url).pathname;
const svg = (size: number, opts?: Parameters<typeof appIconMarkup>[1]) => Buffer.from(appIconMarkup(size, opts));

await Promise.all([
  sharp(svg(1024)).resize(192, 192).png().toFile(`${out}icon-192.png`),
  sharp(svg(1024)).resize(512, 512).png().toFile(`${out}icon-512.png`),
  // maskable: full bleed, mark inside the 80% safe zone
  sharp(svg(1024, { radius: 0, mark: 0.5 })).resize(512, 512).png().toFile(`${out}maskable-512.png`),
  sharp(svg(1024, { radius: 0, mark: 0.56 })).resize(180, 180).png().toFile(`${out}apple-touch-icon.png`),
  sharp(svg(1024)).resize(64, 64).png().toFile(`${out}favicon-64.png`),
]);
await Bun.write(`${out}favicon.svg`, appIconMarkup(64, { mark: 0.66 }));
console.log('icons written to', out);
