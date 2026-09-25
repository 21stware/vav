/**
 * Map lookup for the document sandbox. `ioPath` is on every vav-local
 * range request — never touch the disk unless a raw key missed.
 */
export function stripWorkingCopySlash(path: string): string {
  return path.replace(/\/+$/, '') || path
}

export function lookupWorkingCopyKey<T>(
  path: string,
  byReal: Map<string, T>,
  byCopy: Map<string, T>,
  normalizeCopy: (path: string) => string,
  canonicalize: (path: string) => string
): T | undefined {
  if (byReal.size === 0 && byCopy.size === 0) return undefined
  const raw = stripWorkingCopySlash(path)
  const direct = byReal.get(raw) ?? byCopy.get(raw) ?? byCopy.get(normalizeCopy(path))
  if (direct) return direct
  const canon = canonicalize(raw)
  if (canon === raw) return undefined
  return byReal.get(canon) ?? byCopy.get(canon)
}
