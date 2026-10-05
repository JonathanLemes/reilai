/**
 * `var(--primary)` → `var(--primary, #0B7F71)`: the light palette is the fallback,
 * the real values come from <ThemeRoot> at runtime. Unknown tokens break the build.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const palettePath = fileURLToPath(new URL('../../packages/brand/src/palette.ts', import.meta.url));
const tokens = JSON.parse(
  execFileSync('bun', ['-e', `import { PALETTES } from ${JSON.stringify(palettePath)}; console.log(JSON.stringify(PALETTES.light));`], {
    encoding: 'utf8',
  }),
);

const themeTokens = () => ({
  postcssPlugin: 'theme-tokens',
  Declaration(decl) {
    if (!decl.value.includes('var(--')) return;
    decl.value = decl.value.replace(/var\(--([a-z0-9-]+)\)/g, (_m, name) => {
      if (!(name in tokens)) throw decl.error(`Unknown token: --${name}`);
      return `var(--${name}, ${tokens[name]})`;
    });
  },
});
themeTokens.postcss = true;

export default { plugins: [themeTokens()] };
