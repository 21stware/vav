import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { IPC } from '@shared/ipc'
import type { AppSettings } from '@shared/types'
import {
  mergeHostSettings,
  omitHostSettings,
  pickHostSettings,
  pickSecretPresent
} from '@shared/hostSettings'
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
  clear: (slot: 'api' | 'braveSearch' | 'cloudflare' | 'supabase' | 'tinyfish' | 'vercel') => void
  set: (
    value: string,
    slot: 'api' | 'braveSearch' | 'cloudflare' | 'supabase' | 'tinyfish' | 'vercel'
  ) => void
  get: (slot: 'api' | 'braveSearch' | 'cloudflare' | 'supabase' | 'tinyfish' | 'vercel') => string | null
  maskedHint: (
    slot?: 'api' | 'braveSearch' | 'cloudflare' | 'supabase' | 'tinyfish' | 'vercel'
  ) => string | null
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
  /** Spawned loopback vavd — host prefs share the store Chrome Settings writes. */
  remote?: () => { request: (method: string, params?: unknown) => Promise<unknown> } | null
}

/** Settings get/update/keys/fonts/CLI/file-associations. Analysis stays in the entry. */
export function registerSettingsIpc(
  ipcMain: IpcMain,
  store: SettingsIpcStore,
  secrets: SettingsIpcSecrets,
  host: SettingsIpcHost
): void {
  const remote = (): { request: (method: string, params?: unknown) => Promise<unknown> } | null =>
    host.remote?.() ?? null

  const mergedSettings = async (): Promise<unknown> => {
    const local = host.currentSettings() as AppSettings
    const client = remote()
    if (!client) return local
    try {
      const hostSnap = (await client.request('settings.get')) as Partial<AppSettings>
      return {
        ...mergeHostSettings(local, pickHostSettings(hostSnap)),
        ...pickSecretPresent(hostSnap)
      }
    } catch {
      return local
    }
  }

  ipcMain.handle(IPC.settingsGet, () => mergedSettings())

  ipcMain.handle(IPC.settingsUpdate, async (_event, patch: Partial<AppSettings>) => {
    const previous = store.get()
    const client = remote()
    const hostPatch = pickHostSettings(patch)
    const localPatch = omitHostSettings(patch)
    if (Object.keys(localPatch).length) store.update(localPatch)
    if (client && Object.keys(hostPatch).length) {
      await client.request('settings.update', hostPatch)
    } else if (!client && Object.keys(hostPatch).length) {
      store.update(hostPatch)
    }
    const keys = Object.keys(patch ?? {}).filter((key) => key !== 'apiKeyPresent')
    if (keys.length) {
      appLog().user(LOG_EVENT.userSettingsUpdate, keys.join(', '), { data: { keys } })
    }
    const next = (await mergedSettings()) as AppSettings
    host.applyUpdateSideEffects(previous, patch, next)
    host.broadcastSettings(next)
    return next
  })

  ipcMain.handle(IPC.settingsReset, async () => {
    secrets.clear('api')
    secrets.clear('braveSearch')
    secrets.clear('cloudflare')
    secrets.clear('supabase')
    secrets.clear('vercel')
    const nextLocal = store.reset()
    const client = remote()
    if (client) {
      try {
        await client.request('settings.reset')
      } catch {
        /* keep local reset */
      }
    }
    const next = (await mergedSettings()) as AppSettings
    host.applyResetSideEffects(nextLocal)
    host.broadcastSettings(next)
    return next
  })

  const setHostSecret = async (
    slot: 'api' | 'braveSearch' | 'tinyfish' | 'cloudflare' | 'supabase' | 'vercel',
    value: string
  ): Promise<{ hint: string | null }> => {
    const client = remote()
    if (client) {
      const row = (await client.request('settings.setSecret', { slot, value })) as {
        hint?: string | null
      }
      host.broadcastSettings(await mergedSettings())
      return { hint: row.hint ?? null }
    }
    secrets.set(value, slot)
    host.broadcastSettings(host.currentSettings())
    return { hint: secrets.maskedHint(slot) }
  }

  const hintHostSecret = async (
    slot: 'api' | 'braveSearch' | 'tinyfish' | 'cloudflare' | 'supabase' | 'vercel'
  ): Promise<string | null> => {
    const client = remote()
    if (client) {
      const row = (await client.request('settings.secretHint', { slot })) as { hint?: string | null }
      return row.hint ?? null
    }
    return secrets.maskedHint(slot)
  }

  const revealHostSecret = async (
    event: IpcMainInvokeEvent,
    slot: 'api' | 'braveSearch' | 'tinyfish' | 'cloudflare' | 'supabase' | 'vercel'
  ): Promise<string | null> => {
    if (!(await host.confirmRevealSecret(event))) return null
    const client = remote()
    if (client) {
      const row = (await client.request('settings.revealSecret', { slot })) as { key?: string | null }
      return row.key ?? null
    }
    return secrets.get(slot)
  }

  ipcMain.handle(IPC.settingsKeepAwakeStatus, () => host.keepAwakeStatus())
  ipcMain.handle(IPC.settingsKeepAwakeGrant, () => host.keepAwakeGrant())
  ipcMain.handle(IPC.settingsKeepAwakeRevoke, () => host.keepAwakeRevoke())

  ipcMain.handle(IPC.settingsSetKey, (_event, key: string) => setHostSecret('api', key))
  ipcMain.handle(IPC.settingsRevealKey, (event) => revealHostSecret(event, 'api'))
  ipcMain.handle(IPC.settingsKeyHint, () => hintHostSecret('api'))

  ipcMain.handle(IPC.settingsSetBraveSearchKey, (_event, key: string) =>
    setHostSecret('braveSearch', key)
  )
  ipcMain.handle(IPC.settingsBraveSearchKeyHint, () => hintHostSecret('braveSearch'))

  ipcMain.handle(IPC.settingsSetTinyfishSearchKey, (_event, key: string) =>
    setHostSecret('tinyfish', key)
  )
  ipcMain.handle(IPC.settingsTinyfishSearchKeyHint, () => hintHostSecret('tinyfish'))

  ipcMain.handle(IPC.settingsSetCloudflareToken, (_event, token: string) =>
    setHostSecret('cloudflare', token)
  )
  ipcMain.handle(IPC.settingsCloudflareTokenHint, () => hintHostSecret('cloudflare'))

  ipcMain.handle(IPC.settingsSetSupabaseToken, (_event, token: string) =>
    setHostSecret('supabase', token)
  )
  ipcMain.handle(IPC.settingsSupabaseTokenHint, () => hintHostSecret('supabase'))

  ipcMain.handle(IPC.settingsSetVercelToken, (_event, token: string) =>
    setHostSecret('vercel', token)
  )
  ipcMain.handle(IPC.settingsVercelTokenHint, () => hintHostSecret('vercel'))

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
