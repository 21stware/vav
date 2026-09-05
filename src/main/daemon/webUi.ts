/**
 * Bundled control UI served by `vavd` at `/`.
 * Built from `src/phone-ui` — the same React session shell as desktop.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export function phoneUiDir(
  from = typeof import.meta.dirname === 'string' ? import.meta.dirname : '',
  cwd = process.cwd()
): string | null {
  const roots = [from, cwd, join(cwd, 'packages', 'vavd')].filter(Boolean)
  const rels = [
    '../../../out/phone-ui',
    '../../out/phone-ui',
    'out/phone-ui',
    '../../../extension/phone',
    '../../extension/phone',
    'extension/phone',
    'phone-ui'
  ]
  for (const root of roots) {
    for (const rel of rels) {
      const dir = join(root, rel)
      if (existsSync(join(dir, 'phone.js')) || existsSync(join(dir, 'index.html'))) return dir
    }
  }
  return null
}

export function assembleWebUiHtml(dir = phoneUiDir()): string {
  if (dir && existsSync(join(dir, 'index.html'))) {
    return readFileSync(join(dir, 'index.html'), 'utf8')
  }
  return `<!doctype html>
<html lang="en" data-phone="web">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>VAV</title>
  <link rel="icon" type="image/png" href="/icon.png" />
  <link rel="stylesheet" href="/phone.css" />
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/phone.js"></script>
</body>
</html>
`
}

export const WEB_UI_HTML = assembleWebUiHtml()

export function readPhoneUiFile(name: string, dir = phoneUiDir()): string | null {
  if (!dir) return null
  const full = join(dir, name)
  return existsSync(full) ? readFileSync(full, 'utf8') : null
}

export function phoneUiMime(name: string): string {
  if (name.endsWith('.css')) return 'text/css; charset=utf-8'
  if (name.endsWith('.js')) return 'text/javascript; charset=utf-8'
  if (name.endsWith('.html')) return 'text/html; charset=utf-8'
  if (name.endsWith('.png')) return 'image/png'
  if (name.endsWith('.map')) return 'application/json; charset=utf-8'
  return 'application/octet-stream'
}
