import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      ignored: ['**/dist/**', '**/.git/**']
    },
    proxy: {
      '/msvt-api': {
        target: 'https://web-gis-msvt-9mx3.vercel.app',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/msvt-api/, ''),
      }
    }
  },
  preview: {
    proxy: {
      '/msvt-api': {
        target: 'https://web-gis-msvt-9mx3.vercel.app',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/msvt-api/, ''),
      }
    }
  }
})