/** Load a file as ArrayBuffer — prefer vav-local stream, fall back to base64 IPC. */

import { isOfficeLockFile, OFFICE_LOCK_FILE_MESSAGE } from '@shared/officeLock'
import { localFileStreamUrl } from '@shared/localFileUrl'

export async function loadFileBuffer(path: string): Promise<ArrayBuffer> {
  if (isOfficeLockFile(path)) {
    throw new Error(OFFICE_LOCK_FILE_MESSAGE)
  }

  // Stream via privileged protocol (supports large files; no base64 IPC tax).
  try {
    const res = await fetch(localFileStreamUrl(path))
    if (res.ok) {
      const buffer = await res.arrayBuffer()
      assertOfficeMagic(path, buffer)
      return buffer
    }
  } catch {
    // fall through to IPC
  }

  const result = await window.vav.files.readBinary(path)
  if (!result.ok) throw new Error(result.error)
  const binary = atob(result.base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  assertOfficeMagic(path, bytes.buffer)
  return bytes.buffer
}

function assertOfficeMagic(path: string, buffer: ArrayBuffer): void {
  // Guard: real OOXML/PDF start with recognizable magic; lock stubs often don't.
  if (buffer.byteLength < 2) return
  const view = new Uint8Array(buffer)
  const b0 = view[0]!
  const b1 = view[1]!
  // ZIP (docx/xlsx/pptx) = PK ; PDF = %P
  const isZip = b0 === 0x50 && b1 === 0x4b
  const isPdf = b0 === 0x25 && b1 === 0x50
  if (!isZip && !isPdf && path.match(/\.(docx|xlsx|pptx)$/i)) {
    throw new Error(OFFICE_LOCK_FILE_MESSAGE)
  }
}

export function bufferToBlob(buffer: ArrayBuffer, mime: string): Blob {
  return new Blob([buffer], { type: mime })
}
