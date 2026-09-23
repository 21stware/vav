import type { IpcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { AppPathSnapshot } from '@shared/appPaths'
import {
  buildAppPathSnapshot,
  copyAppDataIfEmpty,
  defaultAppDataDir,
  ensureDir,
  expandUserPath,
  readAppPathOverrides,
  resolveTempDir,
  writeAppPathOverrides
} from '../store/appPaths.ts'

export type AppPathsIpcHost = {
  legacyUserDataDir: () => string
  currentUserDataDir: () => string
  home: () => string
  preferLegacyWhenEmpty?: () => boolean
  onTempDirChanged: (dir: string) => void
}

export function registerAppPathsIpc(ipcMain: IpcMain, host: AppPathsIpcHost): void {
  const snapshot = (): AppPathSnapshot =>
    buildAppPathSnapshot({
      overrides: readAppPathOverrides(host.legacyUserDataDir()),
      legacyDir: host.legacyUserDataDir(),
      currentUserDataDir: host.currentUserDataDir(),
      home: host.home(),
      preferLegacyWhenEmpty: host.preferLegacyWhenEmpty?.()
    })

  ipcMain.handle(IPC.settingsAppPaths, () => snapshot())

  ipcMain.handle(IPC.settingsSetAppDataDir, (_event, raw: string | null) => {
    const home = host.home()
    const legacy = host.legacyUserDataDir()
    const next = raw == null || !String(raw).trim() ? defaultAppDataDir(home) : expandUserPath(String(raw), home)
    if (!next) return snapshot()
    ensureDir(next)
    copyAppDataIfEmpty(host.currentUserDataDir(), next)
    writeAppPathOverrides(legacy, { appDataDir: next })
    return snapshot()
  })

  ipcMain.handle(IPC.settingsSetTempDir, (_event, raw: string | null) => {
    const home = host.home()
    const legacy = host.legacyUserDataDir()
    const next = raw == null || !String(raw).trim() ? '' : expandUserPath(String(raw), home)
    if (next) ensureDir(next)
    writeAppPathOverrides(legacy, { tempDir: next })
    const effective = resolveTempDir({
      overrides: readAppPathOverrides(legacy),
      home
    })
    host.onTempDirChanged(effective)
    return snapshot()
  })
}
