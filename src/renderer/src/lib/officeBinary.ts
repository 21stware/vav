/** Load a file as ArrayBuffer via main-process readBinary. */

import { isOfficeLockFile, OFFICE_LOCK_FILE_MESSAGE } from '@shared/officeLock'

export async function loadFileBuffer(path: string): Promise<ArrayBuffer> {
  if (isOfficeLockFile(path)) {
    throw new Error(OFFICE_LOCK_FILE_MESSAGE)
  }
  const result = await window.vav.files.readBinary(path)
  if (!result.ok) throw new Error(result.error)
  // Guard: real OOXML/PDF start with recognizable magic; lock stubs often don't.
  const binary = atob(result.base64)
  if (binary.length >= 2) {
    const b0 = binary.charCodeAt(0)
    const b1 = binary.charCodeAt(1)
    // ZIP (docx/xlsx/pptx) = PK ; PDF = %P
    const isZip = b0 === 0x50 && b1 === 0x4b
    const isPdf = b0 === 0x25 && b1 === 0x50
    if (!isZip && !isPdf && path.match(/\.(docx|xlsx|pptx)$/i)) {
      throw new Error(OFFICE_LOCK_FILE_MESSAGE)
    }
  }
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

export function bufferToBlob(buffer: ArrayBuffer, mime: string): Blob {
  return new Blob([buffer], { type: mime })
}
