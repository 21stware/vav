/** Minimal POSIX path helpers; the renderer has no access to node:path. */

export function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return index >= 0 ? trimmed.slice(index + 1) : trimmed
}

export function dirname(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const index = trimmed.lastIndexOf('/')
  if (index <= 0) return '/'
  return trimmed.slice(0, index)
}

export function extname(path: string): string {
  const name = basename(path)
  const index = name.lastIndexOf('.')
  return index > 0 ? name.slice(index) : ''
}
