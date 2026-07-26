import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

/**
 * The pi packages are ESM-only, and the main bundle is CJS (node-pty and the
 * Electron entry both want `require`). Externalising them would emit a
 * `require()` Node refuses to resolve, so they are bundled in instead.
 */
const PI_PACKAGES = ['@earendil-works/pi-ai', '@earendil-works/pi-agent-core']

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: PI_PACKAGES })],
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts') }
      }
    },
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') }
      }
    },
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@': resolve('src/renderer/src')
      }
    },
    build: {
      rollupOptions: {
        input: { index: resolve('src/renderer/index.html') }
      }
    }
  }
})
