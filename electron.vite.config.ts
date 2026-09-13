import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

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
 * linkedom's HTMLCanvasElement optionally `require('canvas')` (node-canvas)
 * inside a try/catch and falls back to a no-op shim. In development Vite
 * rewrites that missing optional peer into `__vite-optional-peer-dep`, a
 * module that throws at evaluation — the try/catch never runs, and the app
 * dies on load (`Could not resolve "canvas" imported by "linkedom"`).
 *
 * `resolve.alias` is not enough: the optional-peer handler can run first on
 * the CJS require inside linkedom. A pre `resolveId` intercepts every
 * `canvas` import (dev and build) and points it at linkedom's own shim.
 * We only parse HTML for Readability / search, so a no-op canvas is fine.
 */
const LINKEDOM_CANVAS_SHIM = resolve('node_modules/linkedom/commonjs/canvas-shim.cjs')

function shimLinkedomCanvas(): Plugin {
  return {
    name: 'shim-linkedom-canvas',
    enforce: 'pre',
    resolveId(id) {
      if (id === 'canvas') return LINKEDOM_CANVAS_SHIM
    }
  }
}

/**
 * PDF.js needs cMaps + standard fonts for CJK/forms, and the worker as a
 * same-origin static file. Vite’s `?url` import of the worker under
 * `/@fs/.../node_modules` fails in Electron (“Failed to fetch dynamically
 * imported module”), so we copy the worker next to the public pdfjs assets.
 */
function ensurePdfJsPublicAssets(): void {
  const root = resolve('node_modules/pdfjs-dist')
  const destRoot = resolve('packages/vav-desktop/src/renderer/public/pdfjs')
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
    plugins: [externalizeDepsPlugin({ exclude: PI_PACKAGES }), shimLinkedomCanvas()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('packages/vav-desktop/src/main/index.ts')
        },
        external: OPTIONAL_WS_NATIVE
      }
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@main': resolve('src/main'),
        canvas: LINKEDOM_CANVAS_SHIM
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve('packages/vav-desktop/src/preload/index.ts') }
      }
    },
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    }
  },
  renderer: {
    root: resolve('packages/vav-desktop/src/renderer'),
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@': resolve('packages/vav-desktop/src/renderer/src')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('packages/vav-desktop/src/renderer/index.html'),
          screenshot: resolve('packages/vav-desktop/src/renderer/screenshot.html')
        }
      }
    }
  }
})
