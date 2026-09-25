import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const root = resolve(import.meta.dirname)

export default defineConfig({
  root: resolve(root, 'packages/vav-desktop/src/renderer'),
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(root, 'src/shared'),
      '@': resolve(root, 'packages/vav-desktop/src/renderer/src'),
      shiki: resolve(root, 'packages/vav-desktop/src/renderer/src/lib/shikiStub.ts')
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true
  },
  preview: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true
  }
})
