import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5178,
    strictPort: true,
    proxy: {
      '/drawio': { target: 'http://127.0.0.1:5179', changeOrigin: true },
      '/runtime-assets': { target: 'http://127.0.0.1:5179', changeOrigin: true },
      '/studio-api': { target: 'http://127.0.0.1:5179', changeOrigin: true },
      '/artifacts': { target: 'http://127.0.0.1:5179', changeOrigin: true },
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true
      }
    }
  }
})
