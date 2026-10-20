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
  // Older phone browsers (iOS Safari 14+, Chrome 87+) must be able to parse the bundle.
  build: { target: ['es2020', 'safari14', 'chrome87', 'firefox78'], chunkSizeWarningLimit: 4000 },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Tesla Roadster 3D 赛车闯关',
        short_name: 'Roadster 3D',
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
