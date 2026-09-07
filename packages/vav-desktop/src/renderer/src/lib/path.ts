/** Minimal path helpers; the renderer has no access to node:path. */

/** Compare paths for chip / context equality (tolerant of trailing slash + case). */
export function pathsEqual(a: string, b: string): boolean {
  if (a === b) return true
  const na = a.replace(/\/+$/, '')
  const nb = b.replace(/\/+$/, '')
  if (na === nb) return true
  return na.toLowerCase() === nb.toLowerCase()
}

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

/** Replace or append a file extension (keeps directory + stem). */
export function replaceExt(path: string, newExt: string): string {
  const dir = dirname(path)
  const name = basename(path)
  const stem = name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name
  const ext = newExt.startsWith('.') ? newExt : `.${newExt}`
  const sep = path.includes('\\') ? '\\' : '/'
  if (!dir || dir === name) return `${stem}${ext}`
  return `${dir}${sep}${stem}${ext}`
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
