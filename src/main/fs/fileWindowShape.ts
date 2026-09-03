import type { TextWindowResult } from '../../shared/ipc.ts'

export type BinaryWindowOk = {
  ok: true
  base64: string
  startByte: number
  endByte: number
  totalBytes: number
  truncated: boolean
}

export type BinaryWindowErr = {
  ok: false
  error: string
  startByte: number
  endByte: number
  totalBytes: number
}

export type BinaryWindowResult = BinaryWindowOk | BinaryWindowErr

export function deniedTextWindow(startByte: number, error: string): TextWindowResult {
  return {
    content: '',
    startByte,
    endByte: startByte,
    totalBytes: 0,
    truncated: false,
    error
  }
}

export function directoryTextWindow(error: string): TextWindowResult {
  return {
    content: '',
    startByte: 0,
    endByte: 0,
    totalBytes: 0,
    truncated: false,
    error
  }
}

export function emptyPastEndTextWindow(startByte: number, totalBytes: number): TextWindowResult {
  return {
    content: '',
    startByte,
    endByte: startByte,
    totalBytes,
    truncated: false
  }
}

/** First-window null byte means binary unless the caller forced a text/hex override. */
export function textWindowLooksBinary(
  force: boolean,
  startByte: number,
  hasNullByte: boolean
): boolean {
  return !force && startByte === 0 && hasNullByte
}

export function binaryProbeTextWindow(
  startByte: number,
  totalBytes: number,
  error: string
): TextWindowResult {
  return {
    content: '',
    startByte,
    endByte: startByte,
    totalBytes,
    truncated: false,
    error
  }
}

export function textWindowSuccess(
  content: string,
  startByte: number,
  bytesRead: number,
  totalBytes: number
): TextWindowResult {
  const endByte = startByte + bytesRead
  return {
    content,
    startByte,
    endByte,
    totalBytes,
    truncated: endByte < totalBytes
  }
}

export function textWindowCaughtError(
  startByte: number,
  err: unknown
): TextWindowResult {
  return {
    content: '',
    startByte,
    endByte: startByte,
    totalBytes: 0,
    truncated: false,
    error: (err as Error).message
  }
}

export function deniedBinaryWindow(startByte: number, error: string): BinaryWindowErr {
  return { ok: false, error, startByte, endByte: startByte, totalBytes: 0 }
}

export function directoryBinaryWindow(error: string): BinaryWindowErr {
  return { ok: false, error, startByte: 0, endByte: 0, totalBytes: 0 }
}

export function emptyPastEndBinaryWindow(startByte: number, totalBytes: number): BinaryWindowOk {
  return { ok: true, base64: '', startByte, endByte: startByte, totalBytes, truncated: false }
}

export function binaryWindowSuccess(
  base64: string,
  startByte: number,
  bytesRead: number,
  totalBytes: number
): BinaryWindowOk {
  const endByte = startByte + bytesRead
  return { ok: true, base64, startByte, endByte, totalBytes, truncated: endByte < totalBytes }
}

export function binaryWindowCaughtError(startByte: number, err: unknown): BinaryWindowErr {
  return {
    ok: false,
    error: (err as Error).message,
    startByte,
    endByte: startByte,
    totalBytes: 0
  }
}
