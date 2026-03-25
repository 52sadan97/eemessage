import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['app-icon.jpg'],
      manifest: {
        name: 'EEMessage Web',
        short_name: 'EEMessage',
        description: 'WhatsApp benzeri modern mesajlaşma uygulaması',
        theme_color: '#00a884',
        background_color: '#111b21',
        display: 'standalone',
        icons: [
          {
            src: 'app-icon.jpg',
            sizes: '192x192',
            type: 'image/jpeg',
            purpose: 'any'
          },
          {
            src: 'app-icon.jpg',
            sizes: '512x512',
            type: 'image/jpeg',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ],
  define: {
    'global': 'globalThis'
  }
})
