/**
 * HEIC/HEIF preview + metadata (macOS-first).
 *
 * Chromium often cannot paint HEIC directly. We convert a JPEG sidecar via
 * `sips` for the stream URL, and gather camera/date tags for the meta panel.
 * Original path is never modified.
 */

import { existsSync } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'

export interface ImageMetaField {
  key: string
  value: string
}

export interface HeicPreviewResult {
  /** JPEG (or original if conversion skipped) path for vav-local streaming. */
  previewPath: string
  /** True when previewPath is a converted sidecar. */
  converted: boolean
  meta: ImageMetaField[]
}

const HEIC_EXT = new Set(['.heic', '.heif', '.hif'])

export function isHeicPath(path: string): boolean {
  return HEIC_EXT.has(extname(path).toLowerCase())
}

export async function prepareHeicPreview(path: string): Promise<HeicPreviewResult> {
  const meta = await readImageMeta(path)
  if (process.platform !== 'darwin') {
    return { previewPath: path, converted: false, meta }
  }

  try {
    const info = await stat(path)
    const key = createHash('sha1')
      .update(`${path}:${info.mtimeMs}:${info.size}`)
      .digest('hex')
      .slice(0, 16)
    const dir = join(tmpdir(), 'vav-heic-preview')
    await mkdir(dir, { recursive: true })
    const out = join(dir, `${key}.jpg`)
    if (!existsSync(out)) {
      await runCapture('sips', ['-s', 'format', 'jpeg', path, '--out', out], 30_000)
    }
    if (existsSync(out)) {
      return { previewPath: out, converted: true, meta }
    }
  } catch (err) {
    console.warn('[heic] convert failed', path, err)
  }
  return { previewPath: path, converted: false, meta }
}

async function readImageMeta(path: string): Promise<ImageMetaField[]> {
  if (process.platform !== 'darwin') return []
  const fields: ImageMetaField[] = []
  try {
    // Compact property dump; sips is available on every macOS install.
    const raw = await runCapture(
      'sips',
      [
        '-g',
        'all',
        path
      ],
      8_000
    )
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([a-zA-Z0-9]+):\s*(.+)\s*$/)
      if (!m) continue
      const key = m[1]!
      const value = m[2]!.trim()
      if (!value || value === '""') continue
      // Skip noisy binary/profile blobs.
      if (/profile|icc|thumbnail/i.test(key) && value.length > 80) continue
      fields.push({ key, value: value.length > 200 ? `${value.slice(0, 200)}…` : value })
    }
  } catch {
    // optional
  }
  // Prefer a short, useful subset first.
  const prefer = [
    'pixelWidth',
    'pixelHeight',
    'format',
    'formatOptions',
    'space',
    'samplesPerPixel',
    'bitsPerSample',
    'hasAlpha',
    'creation',
    'make',
    'model',
    'software',
    'dpiWidth',
    'dpiHeight'
  ]
  fields.sort((a, b) => {
    const ia = prefer.indexOf(a.key)
    const ib = prefer.indexOf(b.key)
    if (ia === -1 && ib === -1) return a.key.localeCompare(b.key)
    if (ia === -1) return 1
    if (ib === -1) return -1
    return ia - ib
  })
  return fields.slice(0, 40)
}

function runCapture(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    let settled = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      fn()
    }
    child.stdout?.on('data', (c: Buffer) => {
      out += c.toString('utf8')
    })
    child.stderr?.on('data', (c: Buffer) => {
      err += c.toString('utf8')
    })
    child.on('error', (e) => finish(() => reject(e)))
    child.on('close', (code) => {
      finish(() => {
        if (code === 0) resolve(out)
        else reject(new Error(err.trim() || `${cmd} exited ${code}`))
      })
    })
    setTimeout(() => {
      try {
        child.kill()
      } catch {
        // ignore
      }
      finish(() => reject(new Error(`${cmd} timed out`)))
    }, timeoutMs)
  })
}

export function heicDisplayName(path: string): string {
  return basename(path)
}
