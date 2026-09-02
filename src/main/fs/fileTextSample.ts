import type { HostFs } from '../host/HostFs.ts'

/**
 * Heuristic: a byte sample is "text" when it has no NULs and almost no
 * control / replacement characters (used to reopen `binary` as text).
 */
export function bufferLooksLikeText(slice: Uint8Array): boolean {
  if (slice.includes(0)) return false
  const text = Buffer.from(slice).toString('utf8')
  let bad = 0
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    if (code === 0xfffd) bad += 1
    else if (code < 9 || (code > 13 && code < 32)) bad += 1
  }
  return bad / Math.max(text.length, 1) < 0.02
}

export async function looksLikeTextFile(fs: HostFs, path: string, size: number): Promise<boolean> {
  if (size <= 0) return false
  try {
    const sampleSize = Math.min(size, 8192)
    const fh = await fs.open(path, 'r')
    try {
      const buf = Buffer.alloc(sampleSize)
      const { bytesRead } = await fh.read(buf, 0, sampleSize, 0)
      return bufferLooksLikeText(buf.subarray(0, bytesRead))
    } finally {
      await fh.close()
    }
  } catch {
    return false
  }
}
