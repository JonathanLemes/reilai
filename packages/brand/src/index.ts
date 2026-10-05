export * from './logo';
export * from './palette';
export { SOLAR_ICONS, type SolarIcon, type SolarIconName } from './icons.generated';

import { SOLAR_ICONS, type SolarIconName } from './icons.generated';

/** SVG markup of a Solar icon in a given color (Lynx `<svg content>` and the web shell). */
export function iconMarkup(name: SolarIconName, color: string): string {
  const icon = SOLAR_ICONS[name];
  const body = icon.body.split('currentColor').join(color);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${icon.width} ${icon.height}">${body}</svg>`;
}
