import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { IPC } from '@shared/ipc'
import type { AppSettings } from '@shared/types'
import type { CliInstallLocation } from '../cli'
import { parseHexToRgb16, parseOsascriptColorText } from '../window/appleColor'
import { LOG_EVENT } from '@shared/appLog'
import { appLog } from '../log/appLogger'

export type SettingsIpcStore = {
  get: () => AppSettings
  update: (patch: Partial<AppSettings>) => AppSettings
  reset: () => AppSettings
}

export type SettingsIpcSecrets = {
  clear: (slot: 'api' | 'braveSearch' | 'cloudflare' | 'supabase' | 'tinyfish') => void
  set: (value: string, slot: 'api' | 'braveSearch' | 'cloudflare' | 'supabase' | 'tinyfish') => void
  get: (slot: 'api' | 'braveSearch' | 'cloudflare' | 'supabase' | 'tinyfish') => string | null
  maskedHint: (slot?: 'api' | 'braveSearch' | 'cloudflare' | 'supabase' | 'tinyfish') => string | null
}

export type SettingsIpcHost = {
  currentSettings: () => unknown
  applyUpdateSideEffects: (previous: AppSettings, patch: Partial<AppSettings>, next: AppSettings) => void
  applyResetSideEffects: (next: AppSettings) => void
  broadcastSettings: (settings: unknown) => void
  keepAwakeStatus: () => unknown
  keepAwakeGrant: () => Promise<unknown>
  keepAwakeRevoke: () => Promise<unknown>
  confirmRevealSecret: (event: IpcMainInvokeEvent) => Promise<boolean>
  validateKey: (endpoint: string, key: string) => Promise<{ ok: boolean; message?: string }>
  noApiKeyMessage: () => string
  fonts: () => unknown
  registerHotkey: (accelerator: string) => boolean
  pickDirectory: () => Promise<string | null>
  grantPath: (path: string) => void
  pickSurfacePattern: (
    event: IpcMainInvokeEvent
  ) => Promise<
    | { ok: true; url: string; size: number | string }
    | { ok: false; reason: string }
    | null
  >
  chooseColor: (rgb16: [number, number, number]) => Promise<string | null>
  cliStatus: () => unknown
  cliSetLocation: (location: CliInstallLocation) => unknown
  cliInstall: () => unknown
  cliUninstall: () => unknown
  fileAssociations: () => unknown
  fileAssociationForPath: (path: string) => Promise<unknown>
  setFileAssociation: (formatId: string) => unknown
  unsetFileAssociation: (formatId: string) => unknown
  registerAllFileAssociations: () => unknown
}

/** Settings get/update/keys/fonts/CLI/file-associations. Analysis stays in the entry. */
export function registerSettingsIpc(
  ipcMain: IpcMain,
  store: SettingsIpcStore,
  secrets: SettingsIpcSecrets,
  host: SettingsIpcHost
): void {
  ipcMain.handle(IPC.settingsGet, () => host.currentSettings())

  ipcMain.handle(IPC.settingsUpdate, (_event, patch: Partial<AppSettings>) => {
    const previous = store.get()
    const next = store.update(patch)
    const keys = Object.keys(patch ?? {}).filter((key) => key !== 'apiKeyPresent')
    if (keys.length) {
      appLog().user(LOG_EVENT.userSettingsUpdate, keys.join(', '), { data: { keys } })
    }
    host.applyUpdateSideEffects(previous, patch, next)
    const settings = host.currentSettings()
    host.broadcastSettings(settings)
    return settings
  })

  ipcMain.handle(IPC.settingsReset, () => {
    secrets.clear('api')
    secrets.clear('braveSearch')
    secrets.clear('cloudflare')
    secrets.clear('supabase')
    const next = store.reset()
    host.applyResetSideEffects(next)
    const settings = host.currentSettings()
    host.broadcastSettings(settings)
    return settings
  })

  ipcMain.handle(IPC.settingsKeepAwakeStatus, () => host.keepAwakeStatus())
  ipcMain.handle(IPC.settingsKeepAwakeGrant, () => host.keepAwakeGrant())
  ipcMain.handle(IPC.settingsKeepAwakeRevoke, () => host.keepAwakeRevoke())

  ipcMain.handle(IPC.settingsSetKey, (_event, key: string) => {
    secrets.set(key, 'api')
    host.broadcastSettings(host.currentSettings())
    return { hint: secrets.maskedHint('api') }
  })

  ipcMain.handle(IPC.settingsRevealKey, async (event) => {
    if (!(await host.confirmRevealSecret(event))) return null
    return secrets.get('api')
  })
  ipcMain.handle(IPC.settingsKeyHint, () => secrets.maskedHint('api'))

  ipcMain.handle(IPC.settingsSetBraveSearchKey, (_event, key: string) => {
    secrets.set(key, 'braveSearch')
    host.broadcastSettings(host.currentSettings())
    return { hint: secrets.maskedHint('braveSearch') }
  })
  ipcMain.handle(IPC.settingsBraveSearchKeyHint, () => secrets.maskedHint('braveSearch'))

  ipcMain.handle(IPC.settingsSetTinyfishSearchKey, (_event, key: string) => {
    secrets.set(key, 'tinyfish')
    host.broadcastSettings(host.currentSettings())
    return { hint: secrets.maskedHint('tinyfish') }
  })
  ipcMain.handle(IPC.settingsTinyfishSearchKeyHint, () => secrets.maskedHint('tinyfish'))

  ipcMain.handle(IPC.settingsSetCloudflareToken, (_event, token: string) => {
    secrets.set(token, 'cloudflare')
    host.broadcastSettings(host.currentSettings())
    return { hint: secrets.maskedHint('cloudflare') }
  })
  ipcMain.handle(IPC.settingsCloudflareTokenHint, () => secrets.maskedHint('cloudflare'))

  ipcMain.handle(IPC.settingsSetSupabaseToken, (_event, token: string) => {
    secrets.set(token, 'supabase')
    host.broadcastSettings(host.currentSettings())
    return { hint: secrets.maskedHint('supabase') }
  })
  ipcMain.handle(IPC.settingsSupabaseTokenHint, () => secrets.maskedHint('supabase'))

  ipcMain.handle(IPC.settingsValidateKey, async (_event, key: string) => {
    const settings = store.get()
    const effective = key?.trim() || secrets.get('api')
    if (!effective) return { ok: false, message: host.noApiKeyMessage() }
    return host.validateKey(settings.apiEndpoint, effective)
  })

  ipcMain.handle(IPC.settingsFonts, () => host.fonts())

  ipcMain.handle(IPC.settingsSetHotkey, (_event, accelerator: string) => {
    const ok = host.registerHotkey(accelerator)
    if (ok) store.update({ globalHotkey: accelerator })
    else host.registerHotkey(store.get().globalHotkey)
    const settings = host.currentSettings()
    if (ok) host.broadcastSettings(settings)
    return { ok, settings }
  })

  ipcMain.handle(IPC.settingsPickDirectory, async () => {
    const path = await host.pickDirectory()
    if (path) host.grantPath(path)
    return path
  })

  ipcMain.handle(IPC.settingsPickSurfacePattern, (event) => host.pickSurfacePattern(event))

  ipcMain.handle(IPC.settingsPickColor, (_event, defaultHex?: string) => {
    const rgb16 = parseHexToRgb16(defaultHex) ?? [0, 0, 0]
    return host.chooseColor(rgb16).then((raw) =>
      raw == null ? null : parseOsascriptColorText(raw)
    )
  })

  ipcMain.handle(IPC.settingsCliStatus, () => host.cliStatus())
  ipcMain.handle(IPC.settingsCliSetLocation, (_event, location: CliInstallLocation) =>
    host.cliSetLocation(location)
  )
  ipcMain.handle(IPC.settingsCliInstall, () => host.cliInstall())
  ipcMain.handle(IPC.settingsCliUninstall, () => host.cliUninstall())
  ipcMain.handle(IPC.settingsFileAssociations, () => host.fileAssociations())
  ipcMain.handle(IPC.settingsFileAssociationForPath, (_event, path: string) =>
    host.fileAssociationForPath(path)
  )
  ipcMain.handle(IPC.settingsSetFileAssociation, (_event, formatId: string) =>
    host.setFileAssociation(formatId)
  )
  ipcMain.handle(IPC.settingsUnsetFileAssociation, (_event, formatId: string) =>
    host.unsetFileAssociation(formatId)
  )
  ipcMain.handle(IPC.settingsRegisterAllFileAssociations, () => host.registerAllFileAssociations())
}
