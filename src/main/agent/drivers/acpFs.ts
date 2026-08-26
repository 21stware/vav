import { isAbsolute, resolve } from 'node:path'
import { RpcErrorCode } from '../../../shared/cliErrors.ts'

export interface AcpFileAccess {
  readTextFile(path: string): Promise<{ content: string; error?: string; truncated?: boolean }>
  writeTextFile(path: string, content: string): Promise<{ ok: boolean; error?: string }>
}

export class AcpRpcError extends Error {
  readonly code: number
  readonly data?: unknown
  constructor(code: number, message: string, data?: unknown) {
    super(message)
    this.code = code
    this.data = data
  }

  toJson(): { code: number; message: string; data?: unknown } {
    return this.data === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, data: this.data }
  }
}

export function resolveAcpPath(raw: unknown, _cwd: string): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new AcpRpcError(RpcErrorCode.invalidParams, 'path must be an absolute string')
  }
  const path = raw.trim()
  if (!isAbsolute(path)) {
    throw new AcpRpcError(RpcErrorCode.invalidParams, 'ACP file paths must be absolute')
  }
  return resolve(path)
}

function sliceLines(content: string, line?: number, limit?: number): string {
  if (line == null && limit == null) return content
  const lines = content.split('\n')
  const start = Math.max(0, (line ?? 1) - 1)
  const end = limit != null ? start + Math.max(0, limit) : lines.length
  return lines.slice(start, end).join('\n')
}

export async function acpReadTextFile(
  files: AcpFileAccess,
  params: Record<string, unknown>,
  cwd: string
): Promise<{ content: string }> {
  const path = resolveAcpPath(params.path, cwd)
  const line = typeof params.line === 'number' ? params.line : undefined
  const limit = typeof params.limit === 'number' ? params.limit : undefined
  const result = await files.readTextFile(path)
  if (result.error) {
    throw new AcpRpcError(RpcErrorCode.resourceNotFound, result.error)
  }
  return { content: sliceLines(result.content, line, limit) }
}

export async function acpWriteTextFile(
  files: AcpFileAccess,
  params: Record<string, unknown>,
  cwd: string
): Promise<{ path: string; original: string | null; content: string }> {
  const path = resolveAcpPath(params.path, cwd)
  if (typeof params.content !== 'string') {
    throw new AcpRpcError(RpcErrorCode.invalidParams, 'content must be a string')
  }
  let original: string | null = null
  try {
    const existing = await files.readTextFile(path)
    if (!existing.error) original = existing.content
  } catch {
    original = null
  }
  const written = await files.writeTextFile(path, params.content)
  if (!written.ok) {
    throw new AcpRpcError(RpcErrorCode.internalError, written.error || 'Failed to write file')
  }
  return { path, original, content: params.content }
}
