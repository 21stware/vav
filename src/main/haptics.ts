import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'

/**
 * macOS Force Touch trackpad haptic feedback.
 *
 * Electron exposes no built-in haptics API and `navigator.vibrate()` only works
 * on Android, so the only way to drive a MacBook trackpad is the native
 * `NSHapticFeedbackManager`. `electron-trackpad-utils` wraps that. It is a
 * macOS-only native module, so we load it lazily and swallow failures —
 * on other platforms (or without a Force Touch trackpad) the IPC handlers
 * simply report `available: false` instead of crashing startup.
 */

type Trigger = () => void

/** Loaded once at module init on macOS; `null` elsewhere or if loading fails. */
function loadTrigger(): { available: boolean; trigger: Trigger | null; reason?: string } {
  if (process.platform !== 'darwin') return { available: false, trigger: null }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const trackpad = require('electron-trackpad-utils') as { triggerFeedback: () => void }
    if (typeof trackpad.triggerFeedback === 'function') {
      return { available: true, trigger: () => trackpad.triggerFeedback() }
    }
    return { available: false, trigger: null, reason: 'no triggerFeedback export' }
  } catch (err) {
    console.warn('[haptics] trackpad module unavailable:', err)
    return { available: false, trigger: null, reason: String(err) }
  }
}

const haptic = loadTrigger()

/** Register the renderer-facing haptics IPC handlers. */
export function registerHapticsIpc(): void {
  ipcMain.handle(IPC.hapticsAvailable, () => ({ available: haptic.available }))

  ipcMain.handle(IPC.hapticsTap, () => {
    if (!haptic.available || !haptic.trigger) {
      return { ok: false, error: haptic.reason ?? 'unavailable' }
    }
    try {
      haptic.trigger()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })
}
