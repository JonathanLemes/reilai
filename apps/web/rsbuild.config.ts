import { pluginWebPlatform } from '@lynx-js/web-platform-rsbuild-plugin';
import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

import pkg from './package.json' with { type: 'json' };

/** Browser / PWA shell. The Lynx screens come from apps/app (served at /bundles). */
export default defineConfig({
  plugins: [pluginReact(), pluginWebPlatform({})],
  source: {
    entry: { index: './src/index.tsx' },
    define: { 'process.env.REILAI_VERSION': JSON.stringify(pkg.version) },
  },
  html: {
    title: 'ReilAI',
    favicon: './public/icons/favicon.svg',
    meta: {
      viewport: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content',
      'theme-color': '#F4F6F6',
      description: 'Claude Code and Codex, anywhere.',
      'apple-mobile-web-app-capable': 'yes',
      'mobile-web-app-capable': 'yes',
      'apple-mobile-web-app-status-bar-style': 'default',
      'apple-mobile-web-app-title': 'ReilAI',
    },
    tags: [
      { tag: 'link', attrs: { rel: 'manifest', href: '/manifest.webmanifest' } },
      { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png' } },
    ],
  },
  output: { distPath: { root: 'dist' }, cleanDistPath: true },
  server: {
    port: 5420,
    publicDir: [{ name: 'public' }],
    historyApiFallback: true,
    proxy: { '/ws': { target: 'http://127.0.0.1:7420', ws: true }, '/api': 'http://127.0.0.1:7420', '/bundles': 'http://127.0.0.1:7420' },
  },
});
