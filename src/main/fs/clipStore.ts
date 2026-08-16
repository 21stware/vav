import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'

const CLIP_ROOT = join(tmpdir(), 'vav-clips')

export function isClipPath(path: string): boolean {
  if (!path) return false
  return path.replace(/\\/g, '/').includes('/vav-clips/')
}

const SAFE_NAME = /[^A-Za-z0-9._-]+/g

export function clipRoot(): string {
  return CLIP_ROOT
}

function safeFilename(name: string, fallback: string): string {
  const base = basename(name || '').replace(SAFE_NAME, '_')
  const trimmed = base.replace(/^\.+/, '')
  return trimmed || fallback
}

function hashBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16)
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
  if (bytes.length === 0) return { ok: false, error: 'Empty clip' }

  const displayName = safeFilename(input.filename, hasB64 ? 'image.png' : 'app.html')
  const dir = join(CLIP_ROOT, hashBytes(bytes))
  const dest = join(dir, displayName)
  try {
    mkdirSync(dir, { recursive: true })
    if (!existsSync(dest)) writeFileSync(dest, bytes)
    return { ok: true, path: dest, displayName }
  } catch (err) {
    return { ok: false, error: (err as Error).message || 'Failed to write clip' }
  }
}
