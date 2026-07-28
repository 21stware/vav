/** Minimal path helpers; the renderer has no access to node:path. */

export function basename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return index >= 0 ? trimmed.slice(index + 1) : trimmed
}

export function dirname(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (index <= 0) return trimmed.startsWith('/') ? '/' : trimmed
  if (/^[A-Za-z]:$/.test(trimmed.slice(0, index))) return trimmed.slice(0, index + 1)
  return trimmed.slice(0, index)
}

export function extname(path: string): string {
  const name = basename(path)
  const index = name.lastIndexOf('.')
  return index > 0 ? name.slice(index) : ''
}

/** Join a directory with a relative (or absolute) path segment. */
export function joinPath(baseDir: string, relative: string): string {
  if (!relative) return baseDir
  if (relative.startsWith('/') || /^[A-Za-z]:[\\/]/.test(relative)) return relative
  const windows = baseDir.includes('\\') || /^[A-Za-z]:/.test(baseDir)
  const sep = windows ? '\\' : '/'
  const stack = baseDir.replace(/[/\\]+$/, '').split(/[/\\]/)
  for (const part of relative.split(/[/\\]/)) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (stack.length > 1) stack.pop()
      continue
    }
    stack.push(part)
  }
  if (windows) return stack.join(sep)
  return `${baseDir.startsWith('/') ? '/' : ''}${stack.filter(Boolean).join('/')}`
}
