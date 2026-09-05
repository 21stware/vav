#!/usr/bin/env node
/**
 * Bundle the desktop session UI for vavd's web page and the Chrome side panel.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { build } = await import(pathToFileURL(require.resolve('esbuild')).href)

const outDir = join(root, 'out', 'phone-ui')
const extDir = join(root, 'extension', 'phone')
if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true })
if (existsSync(extDir)) rmSync(extDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
mkdirSync(extDir, { recursive: true })

const STUB_MODULES = new Set([
  'mermaid',
  'beautiful-mermaid',
  'vega',
  'vega-embed',
  'vega-lite',
  '@viz-js/viz',
  '@xterm/xterm',
  '@xterm/addon-fit',
  '@xterm/addon-unicode11',
  '@xterm/addon-web-links',
  'pdfjs-dist',
  'docx-preview',
  'pptxgenjs',
  'xlsx',
  '@aiden0z/pptx-renderer',
  'electron',
  'node-pty'
])

await build({
  absWorkingDir: root,
  entryPoints: [join(root, 'src', 'phone-ui', 'main.tsx')],
  bundle: true,
  format: 'esm',
  outdir: outDir,
  entryNames: 'phone',
  chunkNames: 'chunk-[name]-[hash]',
  splitting: true,
  platform: 'browser',
  target: ['chrome114', 'safari16'],
  jsx: 'automatic',
  sourcemap: false,
  minify: true,
  logLevel: process.env.VAV_PACK_QUIET === '1' ? 'warning' : 'info',
  alias: {
    '@shared': join(root, 'src', 'shared'),
    '@': join(root, 'src', 'renderer', 'src')
  },
  loader: {
    '.css': 'css',
    '.png': 'file',
    '.svg': 'file',
    '.woff': 'file',
    '.woff2': 'file',
    '.ttf': 'file',
    '.eot': 'file'
  },
  define: {
    'import.meta.env.DEV': 'false',
    'import.meta.env.PROD': 'true',
    'import.meta.env.MODE': '"production"'
  },
  plugins: [
    {
      name: 'phone-host-stubs',
      setup(buildApi) {
        buildApi.onResolve({ filter: /.*/ }, (args) => {
          if (STUB_MODULES.has(args.path)) {
            return { path: args.path, namespace: 'phone-stub' }
          }
          return undefined
        })
        buildApi.onLoad({ filter: /.*/, namespace: 'phone-stub' }, () => ({
          contents: `
            const C = class {};
            const fn = () => undefined;
            export default new Proxy(C, { get: () => fn });
            export const Terminal = C;
            export const FitAddon = C;
            export const Unicode11Addon = C;
            export const WebLinksAddon = C;
            export const renderAsync = fn;
            export const PptxViewer = C;
            export const RECOMMENDED_ZIP_LIMITS = {};
            export const utils = { decode_range: () => ({ s: { r: 0, c: 0 }, e: { r: 0, c: 0 } }) };
            export const read = () => ({ SheetNames: [], Sheets: {} });
            export const write = fn;
          `,
          loader: 'js'
        }))
      }
    }
  ]
})

const html = `<!doctype html>
<html lang="en" data-phone="web">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>VAV</title>
  <link rel="icon" type="image/png" href="/icon.png" />
  <link rel="stylesheet" href="./phone.css" />
</head>
<body>
  <div id="root"></div>
  <script type="module" src="./phone.js"></script>
</body>
</html>
`
writeFileSync(join(outDir, 'index.html'), html)

cpSync(outDir, extDir, { recursive: true })
writeFileSync(
  join(extDir, 'index.html'),
  readFileSync(join(outDir, 'index.html'), 'utf8').replace('data-phone="web"', 'data-phone="extension"')
)

if (!existsSync(join(outDir, 'phone.js'))) {
  throw new Error('build-phone-ui: phone.js was not written')
}
