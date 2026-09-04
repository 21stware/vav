import { createInterface } from 'node:readline'
import type { HostStdioChild } from '../../host/HostProcess.ts'

export interface StdioProcess {
  child: HostStdioChild
  writeLine(obj: unknown): void
  writeRaw(text: string): void
  closeStdin(): void
  kill(signal?: NodeJS.Signals): void
}

/** Line-oriented JSON reader on a stream. */
export function onJsonLines(
  stream: NodeJS.ReadableStream,
  onLine: (value: unknown, raw: string) => void,
  onClose?: () => void
): void {
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  rl.on('line', (line) => {
    const trimmed = line.trim()
    if (!trimmed) return
    try {
      onLine(JSON.parse(trimmed) as unknown, trimmed)
    } catch {
      // Non-JSON noise (banners, progress) — ignore.
    }
  })
  rl.on('close', () => onClose?.())
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null
}

export function dig(obj: unknown, path: string): unknown {
  let cur: unknown = obj
  for (const key of path.split('.')) {
    const rec = asRecord(cur)
    if (!rec) return undefined
    cur = rec[key]
  }
  return cur
}

export function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return undefined
}
