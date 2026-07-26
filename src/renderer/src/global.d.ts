import type { VavApi } from '@shared/ipc'

declare global {
  interface Window {
    vav: VavApi
  }
}

export {}
