/**
 * Binary inspect metadata: owner, timestamps, inode — kept off FileService
 * so the heuristics can be unit-tested without Electron.
 */

export function statTimeMs(ms?: number, date?: Date): number | null {
  if (typeof ms === 'number' && Number.isFinite(ms)) return ms
  if (date instanceof Date) return date.getTime()
  return null
}

export function inodeLabel(ino: number | bigint | null | undefined): string {
  return ino === undefined || ino === null ? '—' : String(ino)
}

export function ownerLabel(
  uid: number,
  self?: { uid: number; username: string } | null
): string {
  if (uid < 0) return '—'
  if (self && self.uid === uid) return self.username
  return String(uid)
}
