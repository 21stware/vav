import type { MessageKey } from '@shared/i18n'
import { STORAGE_SOURCES, type StorageSource } from '@shared/storageSource'

export const STORAGE_SOURCE_LABEL_KEY: Record<StorageSource, MessageKey> = {
  recent: 'sidebar.recentFiles',
  thisMac: 'sidebar.thisMac',
  icloud: 'sidebar.iCloud',
  cloudDisk: 'sidebar.cloudDisk'
}

export function isBrowsableStorageSource(source: StorageSource): boolean {
  return source === 'thisMac' || source === 'icloud'
}

export { STORAGE_SOURCES }
export type { StorageSource }
