import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CLIP_FOLDER, clipDest, clipDisplayName } from '@shared/clipLayout'

const CLIP_ROOT = join(tmpdir(), CLIP_FOLDER)

export function isClipPath(path: string): boolean {
  if (!path) return false
  return path.replace(/\\/g, '/').includes(`/${CLIP_FOLDER}/`)
}

export function clipRoot(): string {
  return CLIP_ROOT
}

function hashBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16)
}

export function writeClipBytes(input: {
  filename: string
  bytes: Buffer
}): { ok: true; path: string; displayName: string } | { ok: false; error: string } {
  const bytes = input.bytes
  if (bytes.length === 0) return { ok: false, error: 'Empty clip' }
  const displayName = clipDisplayName(input.filename)
  const { dir, dest } = clipDest(CLIP_ROOT, hashBytes(bytes), displayName)
  try {
    mkdirSync(dir, { recursive: true })
    if (!existsSync(dest)) writeFileSync(dest, bytes)
    return { ok: true, path: dest, displayName }
  } catch (err) {
    return { ok: false, error: (err as Error).message || 'Failed to write clip' }
  }
}

export function writeClip(input: {
  filename: string
  base64?: string
  text?: string
}): { ok: true; path: string; displayName: string } | { ok: false; error: string } {
  const hasB64 = typeof input.base64 === 'string' && input.base64.length > 0
  const hasText = typeof input.text === 'string'
  if (!hasB64 && !hasText) return { ok: false, error: 'Empty clip' }

  let bytes: Buffer
  try {
    bytes = hasB64 ? Buffer.from(input.base64!, 'base64') : Buffer.from(input.text ?? '', 'utf8')
  } catch {
    return { ok: false, error: 'Invalid clip payload' }
  }
  return writeClipBytes({ filename: input.filename, bytes })
}
