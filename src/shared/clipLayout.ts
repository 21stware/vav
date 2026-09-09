/** Temp overlay folder — same name on desktop, Chrome, and vav-server. */
export const CLIP_FOLDER = 'vav-tuips'

const SAFE_NAME = /[^A-Za-z0-9._-]+/g

export function clipDisplayName(filename: string, fallback = 'image.png'): string {
  const base = String(filename || '').split(/[/\\]/).pop() || ''
  const trimmed = base.replace(SAFE_NAME, '_').replace(/^\.+/, '')
  return trimmed || fallback
}

export function clipRootOf(tmp: string): string {
  const root = String(tmp || '').replace(/[/\\]+$/, '')
  if (!root) return CLIP_FOLDER
  return root.includes('\\') ? `${root}\\${CLIP_FOLDER}` : `${root}/${CLIP_FOLDER}`
}

export function clipDest(
  root: string,
  hash16: string,
  displayName: string
): { dir: string; dest: string } {
  const sep = root.includes('\\') ? '\\' : '/'
  const base = String(root || '').replace(/[/\\]+$/, '')
  const dir = `${base}${sep}${hash16}`
  return { dir, dest: `${dir}${sep}${displayName}` }
}

/** SHA-256, first 16 hex chars — same digest clipStore uses via node:crypto. */
export async function clipHash16(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('SHA-256 is unavailable')
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const digest = await subtle.digest('SHA-256', copy)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16)
}
