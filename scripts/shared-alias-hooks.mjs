/**
 * Resolve `@shared/*` for Node `--experimental-strip-types` (vavd + unit tests).
 * electron-vite already aliases this for the bundled app.
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function candidateFiles(rest) {
  const trimmed = rest.replace(/^\//, '')
  const base = join(root, 'src/shared', trimmed)
  const out = []
  if (trimmed.endsWith('.ts') || trimmed.endsWith('.js')) out.push(base)
  else {
    out.push(`${base}.ts`, join(base, 'index.ts'), `${base}.js`, join(base, 'index.js'))
  }
  return out
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@shared/')) {
    const rest = specifier.slice('@shared/'.length)
    const match = candidateFiles(rest).find((file) => existsSync(file))
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
