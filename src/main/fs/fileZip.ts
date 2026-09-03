/** ZIP local-file header signature. */
const ZIP_LOCAL_FILE = 0x04034b50

/**
 * Scan the first local-file headers in a ZIP prefix for the encryption bit.
 * Stops after 8 entries or when the signature no longer matches.
 */
export function zipLocalHeadersEncrypted(buffer: Uint8Array): boolean {
  const view = Buffer.from(buffer)
  let offset = 0
  for (let i = 0; i < 8 && offset + 30 <= view.length; i++) {
    if (view.readUInt32LE(offset) !== ZIP_LOCAL_FILE) break
    const flags = view.readUInt16LE(offset + 6)
    if (flags & 0x1) return true
    const nameLen = view.readUInt16LE(offset + 26)
    const extraLen = view.readUInt16LE(offset + 28)
    const compSize = view.readUInt32LE(offset + 18)
    offset += 30 + nameLen + extraLen + compSize
  }
  return false
}
