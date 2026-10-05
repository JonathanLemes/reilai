/**
 * Writes the static logo files (README, design tools) from src/logo.ts:
 * icon.svg (app icon on the ink tile) and logo.svg (the mark alone, signal teal).
 * Run `bun scripts/generate-logo-files.ts` after changing the mark.
 */
import { appIconMarkup, BRAND, logoMarkup } from '../src/logo';

const dir = new URL('../', import.meta.url).pathname;
await Bun.write(`${dir}icon.svg`, `${appIconMarkup(1024)}\n`);
await Bun.write(`${dir}logo.svg`, `${logoMarkup(BRAND.signal)}\n`);
console.log('icon.svg and logo.svg written');
