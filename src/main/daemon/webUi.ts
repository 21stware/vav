/**
 * Bundled control UI served by `vavd` at `/`.
 * Markup, tokens, transcript, and run bar live in `extension/lib/ui`
 * — the same modules the Chrome side panel imports.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export function phoneUiDir(
  from = typeof import.meta.dirname === 'string' ? import.meta.dirname : '',
  cwd = process.cwd()
): string | null {
  const roots = [from, cwd, join(cwd, 'packages', 'vavd')].filter(Boolean)
  const rels = [
    '../../../extension/lib/ui',
    '../../extension/lib/ui',
    'extension/lib/ui',
    'phone-ui'
  ]
  for (const root of roots) {
    for (const rel of rels) {
      const dir = join(root, rel)
      if (existsSync(join(dir, 'shell.js'))) return dir
    }
  }
  return null
}

export function assembleWebUiHtml(dir = phoneUiDir()): string {
  const ui = dir ? `/ui` : ''
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>VAV</title>
  <link rel="icon" type="image/png" href="/icon.png" />
  <link rel="stylesheet" href="${ui}/tokens.css" />
  <link rel="stylesheet" href="${ui}/shell.css" />
</head>
<body class="app-shell is-web"></body>
<script type="module" src="${ui}/webClient.js"></script>
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
  return 'application/octet-stream'
}

