import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Served from https://dasabhijit.github.io/bhag/
export default defineConfig({
  base: '/bhag/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Bhag',
        short_name: 'Bhag',
        description: 'Split bills with friends and family',
        theme_color: '#0f766e',
        background_color: '#f3f6f5',
        display: 'standalone',
        start_url: '/bhag/',
        scope: '/bhag/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Only the app shell is cached. Data always comes from the network, so balances are never stale.
        navigateFallback: '/bhag/index.html',
        navigateFallbackDenylist: [/^\/bhag\/auth/],
      },
    }),
  ],
})
