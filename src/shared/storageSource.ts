/**
 * Storage category sources. Recent + this machine already exist;
 * iCloud is a local/remote folder root; CloudDisk is reserved until
 * a provider is wired.
 */
export const STORAGE_SOURCES = ['recent', 'thisMac', 'icloud', 'cloudDisk'] as const
export type StorageSource = (typeof STORAGE_SOURCES)[number]

export function isStorageSource(value: unknown): value is StorageSource {
  return typeof value === 'string' && (STORAGE_SOURCES as readonly string[]).includes(value)
}

export function parseStorageSource(value: unknown): StorageSource {
  return isStorageSource(value) ? value : 'recent'
}
