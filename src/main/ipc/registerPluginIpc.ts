import type { IpcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { PluginSnapshot } from '@shared/plugins'
import { pluginHostKind } from '@shared/plugins'
import type { FileService } from '../fs/FileService'
import type { PluginService } from '../plugins/PluginService'
import { pluginAccessPaths } from '../plugins/pluginPaths'

export function registerPluginIpc(
  ipcMain: IpcMain,
  plugins: PluginService,
  files?: FileService
): void {
  ipcMain.handle(IPC.pluginsList, (_event, host?: string | null) => {
    const snap = plugins.snapshot(host)
    grantPluginFiles(files, snap)
    return snap
  })
  ipcMain.handle(
    IPC.pluginsSetEnabled,
    (_event, host: string, pluginId: string, enabled: boolean) => {
      const result = plugins.setEnabled(pluginHostKind(host), String(pluginId || ''), enabled === true)
      if (result.ok) grantPluginFiles(files, result.snapshot)
      return result.ok ? result.snapshot : result
    }
  )
  ipcMain.handle(IPC.pluginsCreate, (_event, kind: string, name: string) => {
    const allowed = kind === 'skill' || kind === 'mcp' || kind === 'hook' || kind === 'plugin'
    if (!allowed) return { ok: false as const, error: 'Unknown plugin kind' }
    const result = plugins.create(kind, String(name || ''))
    if (result.ok) grantPluginFiles(files, result.snapshot)
    return result.ok ? result.snapshot : result
  })
  ipcMain.handle(IPC.pluginsWrite, (_event, path: string, content: string) => {
    const result = plugins.writeConfig(String(path || ''), String(content ?? ''))
    if (result.ok) grantPluginFiles(files, result.snapshot)
    return result.ok ? result.snapshot : result
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
