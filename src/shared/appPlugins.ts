/**
 * First-party app-column catalog. UI, tools, and prompts read this table
 * instead of closed `if (kind === 'knowledge')` chains.
 *
 * Devices is host chrome, not a catalog kind.
 */
export const APP_CATALOG_IDS = ['knowledge', 'data', 'scheduled', 'storage'] as const

export type AppResourceKind = (typeof APP_CATALOG_IDS)[number]

export type AppCatalogPlugin = {
  id: AppResourceKind
  label: string
  noun: string
  nav: {
    testId: string
    labelKey: string
  }
  tools: {
    write: string
    edit: string
  }
}

export const APP_CATALOG_PLUGINS: readonly AppCatalogPlugin[] = [
  {
    id: 'knowledge',
    label: 'Knowledge',
    noun: 'Knowledge note',
    nav: { testId: 'applications-tab-knowledge', labelKey: 'sidebar.category.knowledge' },
    tools: { write: 'note_write', edit: 'note_edit' }
  },
  {
    id: 'data',
    label: 'Data',
    noun: 'Data object',
    nav: { testId: 'applications-tab-data', labelKey: 'sidebar.category.data' },
    tools: { write: 'analysis_write', edit: 'analysis_edit' }
  },
  {
    id: 'scheduled',
    label: 'Scheduled',
    noun: 'scheduled task',
    nav: { testId: 'new-scheduled', labelKey: 'sidebar.nav.scheduledTask' },
    tools: { write: 'schedule_write', edit: 'schedule_edit' }
  },
  {
    id: 'storage',
    label: 'Storage',
    noun: 'file',
    nav: { testId: 'applications-tab-storage', labelKey: 'sidebar.category.storage' },
    tools: { write: 'storage_write', edit: 'storage_edit' }
  }
]

const KIND_SET = new Set<string>(APP_CATALOG_IDS)

export function isAppResourceKind(value: string): value is AppResourceKind {
  return KIND_SET.has(value)
}

export function appCatalogPlugin(id: string): AppCatalogPlugin | undefined {
  return APP_CATALOG_PLUGINS.find((plugin) => plugin.id === id)
}

export type AppResourceRow = {
  url: string
  kind: AppResourceKind
  title: string
  id?: string
  path?: string | null
  folder?: string | null
  updatedAt?: number
}

export function formatAppCatalogCapabilities(kindIds = APP_CATALOG_IDS): string {
  return kindIds.join(' | ')
}
