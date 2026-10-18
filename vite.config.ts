import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Relative base so the build also works from a GitHub Pages sub-path.
  base: './',
  server: {
    host: true,
    port: 5173,
    // Online play in dev: run `npm run dev:server` alongside `npm run dev`.
    proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'DESERT THRUST',
        short_name: 'THRUST',
        description: '3D 特技赛车闯关：飞越车队、空中横滚、六大场景。',
        lang: 'zh-CN',
        start_url: './',
        scope: './',
        display: 'fullscreen',
        orientation: 'landscape',
        background_color: '#0b0d12',
        theme_color: '#0b0d12',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The physics WASM is inlined in the main chunk, so allow a large precache entry.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,png,svg,wasm}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
});
