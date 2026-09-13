import type { IpcMain } from 'electron'
import { shell, systemPreferences } from 'electron'
import { IPC } from '@shared/ipc'
import type { ComputerApp, ComputerPermissionState, ComputerUseStatus } from '@shared/computerUse'

const ACCESSIBILITY_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
const SCREEN_RECORDING_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'

export type ComputerIpcHost = {
  status: () => ComputerUseStatus
  listApps: () => Promise<ComputerApp[]>
}

export function macAccessibilityState(): ComputerPermissionState {
  if (process.platform !== 'darwin') return 'granted'
  try {
    return systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'denied'
  } catch {
    return 'unknown'
  }
}

export function macScreenRecordingState(): ComputerPermissionState {
  if (process.platform !== 'darwin') return 'granted'
  return systemPreferences.getMediaAccessStatus('screen') as ComputerPermissionState
}

export function macComputerPermissionsReady(): boolean {
  return macAccessibilityState() === 'granted' && macScreenRecordingState() === 'granted'
}

export function registerComputerIpc(ipcMain: IpcMain, host: ComputerIpcHost): void {
  ipcMain.handle(IPC.computerStatus, () => host.status())
  ipcMain.handle(IPC.computerListApps, async () => {
    try {
      return await host.listApps()
    } catch {
      return []
    }
  })
  ipcMain.handle(IPC.computerRequestAccessibility, async () => {
    if (process.platform !== 'darwin') return true
    try {
      return systemPreferences.isTrustedAccessibilityClient(true)
    } catch {
      return false
    }
  })
  ipcMain.handle(IPC.computerOpenAccessibilitySettings, async () => {
    if (process.platform !== 'darwin') return
    await shell.openExternal(ACCESSIBILITY_SETTINGS_URL)
  })
  ipcMain.handle(IPC.computerOpenScreenRecordingSettings, async () => {
    if (process.platform !== 'darwin') return
    await shell.openExternal(SCREEN_RECORDING_SETTINGS_URL)
  })
}
