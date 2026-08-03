/**
 * Legacy Office → modern format for in-app preview.
 *
 * macOS: `textutil` can convert .doc → .docx / .html.
 * .ppt has no reliable free converter on stock macOS — we surface a clear
 * message rather than a hard product "unsupported" wall.
 * Never overwrites the original; results live under tmp/vav-office-convert.
 */

import { existsSync } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'

export type LegacyConvertKind = 'doc' | 'ppt' | 'xls'

export interface LegacyConvertResult {
  ok: true
  /** Path to converted file (docx / html / xlsx). */
  path: string
  /** Kind the preview pipeline should treat the result as. */
  previewKind: 'docx' | 'html' | 'xlsx'
  warning?: string
}

export interface LegacyConvertFail {
  ok: false
  error: string
}

export function legacyOfficeKind(path: string): LegacyConvertKind | null {
  const ext = extname(path).toLowerCase()
  if (ext === '.doc') return 'doc'
  if (ext === '.ppt') return 'ppt'
  if (ext === '.xls') return 'xls'
  return null
}

export async function convertLegacyOffice(
  path: string
): Promise<LegacyConvertResult | LegacyConvertFail> {
  const kind = legacyOfficeKind(path)
  if (!kind) return { ok: false, error: 'Not a legacy Office document' }

  if (kind === 'ppt') {
    return {
      ok: false,
      error:
        'Legacy PowerPoint (.ppt) has no built-in converter on this system. Export to .pptx, or open with the system default app.'
    }
  }

  if (process.platform !== 'darwin') {
    return {
      ok: false,
      error:
        'Legacy Office conversion currently uses macOS textutil. Open with the system default app, or convert to .docx/.xlsx first.'
    }
  }

  try {
    const info = await stat(path)
    const key = createHash('sha1')
      .update(`${path}:${info.mtimeMs}:${info.size}`)
      .digest('hex')
      .slice(0, 16)
    const dir = join(tmpdir(), 'vav-office-convert')
    await mkdir(dir, { recursive: true })

    if (kind === 'doc') {
      const out = join(dir, `${key}.docx`)
      if (!existsSync(out)) {
        await run('textutil', ['-convert', 'docx', '-output', out, path], 60_000)
      }
      if (!existsSync(out)) {
        // Fallback HTML if docx fails.
        const html = join(dir, `${key}.html`)
        await run('textutil', ['-convert', 'html', '-output', html, path], 60_000)
        if (existsSync(html)) {
          return {
            ok: true,
            path: html,
            previewKind: 'html',
            warning: 'Converted .doc → HTML for preview (docx conversion unavailable).'
          }
        }
        return { ok: false, error: 'textutil could not convert this .doc file.' }
      }
      return {
        ok: true,
        path: out,
        previewKind: 'docx',
        warning: 'Converted .doc → .docx for preview (original unchanged).'
      }
    }

    // .xls — SheetJS often reads binary xls directly; conversion optional.
    return {
      ok: false,
      error: 'Use the spreadsheet preview path for .xls (no separate conversion needed).'
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message || 'Conversion failed' }
  }
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    let settled = false
    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      fn()
    }
    child.stderr?.on('data', (c: Buffer) => {
      err += c.toString('utf8')
    })
    child.on('error', (e) => finish(() => reject(e)))
    child.on('close', (code) => {
      finish(() => {
        if (code === 0) resolve()
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

export function legacyLabel(path: string): string {
  return basename(path)
}
