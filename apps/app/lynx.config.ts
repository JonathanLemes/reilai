import { pluginReactLynx } from '@lynx-js/react-rsbuild-plugin';
import { defineConfig } from '@lynx-js/rspeedy';

/**
 * One Lynx bundle per screen (same model as the Clube do Patriota app): the host
 * opens `<screen>.lynx.bundle` natively, or `<screen>.web.bundle` in a <lynx-view>.
 */
export default defineConfig({
  output: { minify: process.env.NO_MINIFY ? false : undefined },
  source: {
    entry: {
      sessions: './src/screens/sessions/index.tsx',
      chat: './src/screens/chat/index.tsx',
      new: './src/screens/new/index.tsx',
      settings: './src/screens/settings/index.tsx',
      pair: './src/screens/pair/index.tsx',
    },
  },
  plugins: [pluginReactLynx()],
  // Same source, two outputs: native (lynx) and browser (Lynx for Web)
  environments: {
    web: {},
    lynx: {},
  },
});
