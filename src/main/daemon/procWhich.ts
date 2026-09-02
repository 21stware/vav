/**
 * Resolve an executable on a workspace host (absolute exists, or `command -v`).
 * Used by the daemon `proc.which` RPC so a desktop can list CLI providers on
 * another machine without guessing that machine's PATH.
 */

import type { WorkspaceHost } from '../host/WorkspaceHost.ts'

function isAbsoluteCandidate(path: string, platform?: string): boolean {
  if (path.startsWith('/')) return true
  if (platform === 'win32' && /^[A-Za-z]:[\\/]/.test(path)) return true
  return path.includes('/') || path.includes('\\')
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function firstLine(text: string): string {
  return text.trim().split(/\r?\n/)[0]?.trim() ?? ''
}

function collectStdout(child: {
  stdout: NodeJS.ReadableStream | null
  on(event: 'error', listener: (err: Error) => void): unknown
  on(event: 'close', listener: (code: number | null) => void): unknown
}): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    let out = ''
    child.stdout?.on('data', (chunk) => {
      out += Buffer.from(chunk).toString('utf8')
    })
    child.on('error', () => resolve({ code: 1, out }))
    child.on('close', (code) => resolve({ code: code ?? 1, out }))
  })
}

export async function whichOnHost(
  host: WorkspaceHost,
  candidates: string[]
): Promise<string | null> {
  const names = candidates.map((c) => c.trim()).filter(Boolean)
  if (names.length === 0) return null
  const platform = host.info.platform
  for (const candidate of names) {
    if (isAbsoluteCandidate(candidate, platform)) {
      try {
        if (await host.fs.exists(candidate)) return candidate
      } catch {
        /* ignore */
      }
      continue
    }
    const win = platform === 'win32'
    const child = win
      ? host.process.spawn('where', [candidate], { stdio: ['ignore', 'pipe', 'ignore'] })
      : host.process.spawn('/bin/sh', ['-lc', `command -v ${shQuote(candidate)}`], {
          stdio: ['ignore', 'pipe', 'ignore']
        })
    const { code, out } = await collectStdout(child)
    const hit = firstLine(out)
    if (code === 0 && hit) return hit
  }
  return null
}
