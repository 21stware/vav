/**
 * Resolve `@shared/*` and `@main/*` for Node `--experimental-strip-types`
 * (vav-server + CLI + unit tests). electron-vite aliases the same for the app.
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function candidateFiles(prefix, rest) {
  const trimmed = rest.replace(/^\//, '')
  const base = join(root, prefix, trimmed)
  const out = []
  if (trimmed.endsWith('.ts') || trimmed.endsWith('.js') || trimmed.endsWith('.tsx')) out.push(base)
  else {
    out.push(
      `${base}.ts`,
      `${base}.tsx`,
      join(base, 'index.ts'),
      `${base}.js`,
      join(base, 'index.js')
    )
  }
  return out
}

export async function resolve(specifier, context, nextResolve) {
  for (const [alias, prefix] of [
    ['@shared/', 'src/shared'],
    ['@main/', 'src/main'],
    ['@/', 'packages/vav-desktop/src/renderer/src']
  ]) {
    if (!specifier.startsWith(alias)) continue
    const rest = specifier.slice(alias.length)
    const match = candidateFiles(prefix, rest).find((file) => existsSync(file))
    if (!match) return nextResolve(specifier, context)
    return { shortCircuit: true, url: pathToFileURL(match).href }
  }
  if (
    context.parentURL &&
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    !specifier.endsWith('.ts') &&
    !specifier.endsWith('.js') &&
    !specifier.endsWith('.json') &&
    !specifier.endsWith('.mjs') &&
    !specifier.endsWith('.cjs')
  ) {
    const parent = fileURLToPath(context.parentURL)
    const base = join(dirname(parent), specifier)
    const match = [`${base}.ts`, join(base, 'index.ts')].find((file) => existsSync(file))
    if (match) return { shortCircuit: true, url: pathToFileURL(match).href }
  }
  return nextResolve(specifier, context)
}
