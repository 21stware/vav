import type { IpcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { PluginSnapshot } from '@shared/plugins'
import { pluginHostKind, unwrapPluginMutation } from '@shared/plugins'
import type { FileService } from '../fs/FileService'
import type { PluginService } from '../plugins/PluginService'
import { pluginAccessPaths } from '../plugins/pluginPaths'

export type PluginIpcRemote = {
  request: (method: string, params?: unknown) => Promise<unknown>
}

export function registerPluginIpc(
  ipcMain: IpcMain,
  plugins: PluginService,
  files?: FileService,
  remote?: () => PluginIpcRemote | null
): void {
  const clientOf = (): PluginIpcRemote | null => remote?.() ?? null

  ipcMain.handle(IPC.pluginsList, async (_event, host?: string | null) => {
    const client = clientOf()
    const snap = client
      ? ((await client.request('plugins.list', { host })) as PluginSnapshot)
      : plugins.snapshot(host)
    if (snap && Array.isArray(snap.plugins)) grantPluginFiles(files, snap)
    return snap
  })
  ipcMain.handle(
    IPC.pluginsSetEnabled,
    async (_event, host: string, pluginId: string, enabled: boolean) => {
      const client = clientOf()
      const result = client
        ? unwrapPluginMutation(
            await client.request('plugins.setEnabled', {
              host,
              pluginId,
              enabled: enabled === true
            })
          )
        : (() => {
            const row = plugins.setEnabled(
              pluginHostKind(host),
              String(pluginId || ''),
              enabled === true
            )
            return row.ok ? row.snapshot : row
          })()
      if (!('ok' in result)) grantPluginFiles(files, result)
      return result
    }
  )
  ipcMain.handle(IPC.pluginsCreate, async (_event, kind: string, name: string) => {
    const allowed = kind === 'skill' || kind === 'mcp' || kind === 'hook' || kind === 'plugin'
    if (!allowed) return { ok: false as const, error: 'Unknown plugin kind' }
    const client = clientOf()
    const result = client
      ? unwrapPluginMutation(await client.request('plugins.create', { kind, name: String(name || '') }))
      : (() => {
          const row = plugins.create(kind, String(name || ''))
          return row.ok ? row.snapshot : row
        })()
    if (!('ok' in result)) grantPluginFiles(files, result)
    return result
  })
  ipcMain.handle(IPC.pluginsWrite, async (_event, path: string, content: string) => {
    const client = clientOf()
    const result = client
      ? unwrapPluginMutation(
          await client.request('plugins.write', { path: String(path || ''), content: String(content ?? '') })
        )
      : (() => {
          const row = plugins.writeConfig(String(path || ''), String(content ?? ''))
          return row.ok ? row.snapshot : row
        })()
    if (!('ok' in result)) grantPluginFiles(files, result)
    return result
  })
}

function grantPluginFiles(files: FileService | undefined, snap: PluginSnapshot): void {
  if (!files) return
  for (const path of pluginAccessPaths(snap.host)) files.grantRoot(path)
  files.grantRoot(snap.root)
  for (const plugin of snap.plugins) {
    if (plugin.dir) files.grantRoot(plugin.dir)
    if (plugin.manifestPath) files.grantPath(plugin.manifestPath)
    for (const skill of plugin.skills) {
      files.grantRoot(skill.dir)
      files.grantPath(skill.path)
    }
    for (const server of plugin.mcpServers) files.grantPath(server.configPath)
    for (const hook of plugin.hooks) files.grantPath(hook.configPath)
  }
}
