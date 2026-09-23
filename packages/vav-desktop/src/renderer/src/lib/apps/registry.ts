/**
 * Right-column UI plugins. Catalog identity lives in `@shared/appPlugins`;
 * this table attaches React list / detail / actions.
 */
import type { ComponentType } from 'react'
import type { ConversationMeta } from '@shared/types'
import { APP_CATALOG_PLUGINS, type AppResourceKind } from '@shared/appPlugins'

export type AppColumnDetailContext = {
  conversation?: ConversationMeta
  filePreviewOpen: boolean
}

export type AppColumnListProps = {
  onOpenDetail: () => void
}

export type AppColumnDetailProps = {
  conversation?: ConversationMeta
  previewPath: string | null
  filePreviewOpen: boolean
  onStoragePath: (path: string | null) => void
}

export type AppColumnPlugin = {
  id: AppResourceKind
  hasDetail: (ctx: AppColumnDetailContext) => boolean
  List: ComponentType<AppColumnListProps>
  Detail: ComponentType<AppColumnDetailProps>
  Actions: ComponentType<AppColumnListProps>
}

const plugins = new Map<AppResourceKind, AppColumnPlugin>()

export function registerAppColumnPlugin(plugin: AppColumnPlugin): void {
  plugins.set(plugin.id, plugin)
}

export function getAppColumnPlugin(id: string): AppColumnPlugin | undefined {
  return plugins.get(id as AppResourceKind)
}

export function listAppColumnPlugins(): AppColumnPlugin[] {
  return APP_CATALOG_PLUGINS.map((row) => plugins.get(row.id)).filter(
    (plugin): plugin is AppColumnPlugin => plugin !== undefined
  )
}
