import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Served from https://<user>.github.io/cook-book/, so every asset URL needs
// that prefix. Locally `vite dev` sets its own base, so keep it conditional.
const base = process.env.GITHUB_ACTIONS ? '/cook-book/' : '/';

export default defineConfig({
  base,
  server: { port: 5175 },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      // Registration is done by src/lib/pwa.js so updates land in one reload.
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        name: 'Cook Book',
        short_name: 'Cook Book',
        description: 'A digital scrapbook for recipes.',
        theme_color: '#46607A',
        background_color: '#FAF8F3',
        display: 'standalone',
        // Unlike the other apps this is landscape-first: a two-page spread
        // needs the width, and the iPad is the main cooking device.
        orientation: 'any',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          // The maskable one is its own file: the launcher crops it to a
          // circle, so the mark is drawn smaller with the ground full-bleed.
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // The Firebase SDK is its own set of chunks and is only fetched when
        // you actually sign in — see the note in 10minutestospare.
        globIgnores: ['**/index.esm-*.js'],
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: /\/assets\/index\.esm-.*\.js$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'firebase-sdk',
              expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
});
