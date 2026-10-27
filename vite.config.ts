import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { cloudflare } from '@cloudflare/vite-plugin'

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [vue(), cloudflare({ configPath: 'wrangler.dev.jsonc', config: command === 'build' ? { secrets: { required: [] } } : undefined })],
  build: { sourcemap: false },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
}))
