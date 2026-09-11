import type { WebPreferences } from 'electron'
import { MAIN_WINDOW_MIN_HEIGHT, MAIN_WINDOW_MIN_WIDTH } from '@shared/shellMinSize'

/** Shared renderer prefs — keep timers/rAF alive while the window is hidden. */
export function rendererPrefs(preload: string, extra: WebPreferences = {}): WebPreferences {
  return {
    preload,
    sandbox: false,
    contextIsolation: true,
    nodeIntegration: false,
    backgroundThrottling: false,
    ...extra
  }
}

export function mainWindowSize(flags: {
  snapshotting: boolean
  e2e: boolean
}): { width: number; height: number } {
  if (flags.snapshotting) return { width: 1440, height: 900 }
  if (flags.e2e) return { width: 1100, height: 820 }
  return {
    width: Math.max(MAIN_WINDOW_MIN_WIDTH, 720),
    height: Math.max(MAIN_WINDOW_MIN_HEIGHT, 820)
  }
}

export function hostWindowTitle(appName: string, isLocal: boolean, remoteLabel: string): string {
  if (isLocal) return appName
  const label = remoteLabel.trim() || 'host'
  return `${appName} — ${label}`
}
