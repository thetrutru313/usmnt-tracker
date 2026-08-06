import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

const rawPort = process.env.PORT ?? "5173";
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}
console.log(
  process.env.PORT
    ? `[vite.config] PORT=${port} (from env)`
    : `[vite.config] PORT not set — using default ${port}`,
);

const basePath = process.env.BASE_PATH ?? '/';
console.log(
  process.env.BASE_PATH
    ? `[vite.config] BASE_PATH="${basePath}" (from env)`
    : `[vite.config] BASE_PATH not set — using default "${basePath}"`,
);

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      // Keep the service worker off during dev to avoid conflicts with Vite HMR.
      devOptions: { enabled: false },
      manifest: {
        name: 'USMNT Tracker',
        short_name: 'USMNT',
        description: 'Track the US Men\'s National Soccer Team — player form, injuries, fixtures, and call-up analysis.',
        theme_color: '#002966',
        background_color: '#002966',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Pre-cache all static build output.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2,ttf,eot}'],
        // Serve the app shell for any navigation so the SPA router takes over.
        navigateFallback: 'index.html',
        // Exclude Replit dev endpoints from the SW so hot-reload still works
        // in any environment where devOptions.enabled is true.
        navigateFallbackDenylist: [/^\/__/, /\/api\//],
      },
    }),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
    // Proxy /api/* to the Express API server so the dev server can be hit
    // directly (e.g. by E2E tests) without relying on the Replit path-based
    // proxy at port 80.
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
