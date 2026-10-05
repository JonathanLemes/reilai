/**
 * ReilAI mark ("remote prompt"): a terminal prompt sending its signal far away,
 * you drive the agent from wherever you are. Built on a 256 grid (28 px strokes,
 * 45 degree chevron, arcs centred on the prompt) and expanded to filled outlines.
 */
export const LOGO_SHAPES = '<path d="M63.9 62.1L119.9 118.1A14.0 14.0 0 0 1 119.9 137.9L63.9 193.9A14.0 14.0 0 0 1 44.1 174.1L90.2 128L44.1 81.9A14.0 14.0 0 0 1 63.9 62.1Z"/><path d="M156.19 70.03A78.0 78.0 0 0 1 156.19 185.97A14.0 14.0 0 0 1 137.46 165.16A50.0 50.0 0 0 0 137.46 90.84A14.0 14.0 0 0 1 156.19 70.03ZM197.64 43.69A126.0 126.0 0 0 1 197.64 212.31A14.0 14.0 0 0 1 176.83 193.57A98.0 98.0 0 0 0 176.83 62.43A14.0 14.0 0 0 1 197.64 43.69Z"/>';

/** Tight box around the mark (2 px of air). */
export const LOGO_VIEWBOX = '38 37 194 182';
export const LOGO_ASPECT = 194 / 182;

/** Identity colors: ink tile and the signal teal of the mark (app icon, favicon). */
export const BRAND = { ink: '#0F1416', signal: '#2DD4BF' } as const;

export function logoMarkup(color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${LOGO_VIEWBOX}" fill="${color}">${LOGO_SHAPES}</svg>`;
}

/**
 * App icon: the mark on the ink tile. `radius` is the corner radius as a share of
 * the size (0 for full bleed, e.g. maskable and Android legacy), `mark` the mark's
 * width as a share of the size; `bg: 'none'` leaves the tile out.
 */
export function appIconMarkup(
  size: number,
  { radius = 0.2236, mark = 0.6, bg = BRAND.ink as string, fg = BRAND.signal as string }: { radius?: number; mark?: number; bg?: string; fg?: string } = {},
): string {
  const w = size * mark;
  const scale = w / 194;
  const h = 182 * scale;
  const x = (size - w) / 2 - 38 * scale;
  const y = (size - h) / 2 - 37 * scale;
  const tile = bg === 'none' ? '' : `<rect width="${size}" height="${size}" rx="${size * radius}" fill="${bg}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${tile}<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale.toFixed(5)})" fill="${fg}">${LOGO_SHAPES}</g></svg>`;
}
