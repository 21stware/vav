import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

/**
 * The pi packages are ESM-only, and the main bundle is CJS (node-pty and the
 * Electron entry both want `require`). Externalising them would emit a
 * `require()` Node refuses to resolve, so they are bundled in instead.
 */
const PI_PACKAGES = ['@earendil-works/pi-ai', '@earendil-works/pi-agent-core']

/**
 * `ws` (via pi-ai's google-generative-ai → @google/genai) requires these
 * native accel modules inside a try/catch — they are optional. Bundling turns
 * that guarded require into a hard top-level import and kills app startup, so
 * they stay external and let ws fall back to its pure-JS path.
 */
const OPTIONAL_WS_NATIVE = ['bufferutil', 'utf-8-validate']

/**
 * PDF.js needs cMaps + standard fonts for CJK/forms, and the worker as a
 * same-origin static file. Vite’s `?url` import of the worker under
 * `/@fs/.../node_modules` fails in Electron (“Failed to fetch dynamically
 * imported module”), so we copy the worker next to the public pdfjs assets.
 */
function ensurePdfJsPublicAssets(): void {
  const root = resolve('node_modules/pdfjs-dist')
  const destRoot = resolve('src/renderer/public/pdfjs')
  mkdirSync(destRoot, { recursive: true })
  for (const dir of ['cmaps', 'standard_fonts'] as const) {
    const from = join(root, dir)
    const to = join(destRoot, dir)
    if (!existsSync(from)) continue
    cpSync(from, to, { recursive: true })
  }
  for (const worker of ['pdf.worker.min.mjs', 'pdf.worker.mjs'] as const) {
    const from = join(root, 'build', worker)
    if (!existsSync(from)) continue
    cpSync(from, join(destRoot, worker))
  }
}

ensurePdfJsPublicAssets()

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: PI_PACKAGES })],
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts') },
        external: OPTIONAL_WS_NATIVE
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
