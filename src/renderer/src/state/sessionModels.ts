import type { CliHostKind, ModelOption } from '../../../shared/types.ts'
import {
  agentModelHostKey,
  defaultModelForChatHost,
  filterEnabledModels,
  modelsForChatHost,
  resolveModelForChatHost
} from '../../../shared/agentModels.ts'
import { vendorIdFromEndpoint } from '../../../shared/llmVendors.ts'
import type { AgentModelCatalogEntry } from './sessionTypes.ts'

type CatalogEntry = Pick<AgentModelCatalogEntry, 'models' | 'endpoint'>

export function builtinCatalogVendorId(
  catalog: Record<string, Pick<AgentModelCatalogEntry, 'endpoint'>>,
  accountId: string | null | undefined,
  fallbackEndpoint: string | undefined
): string | null {
  const catalogKey = Object.keys(catalog).find((k) =>
    accountId ? k.endsWith(`:${accountId}`) : k === 'vav'
  )
  const entry = catalogKey ? catalog[catalogKey] : undefined
  return vendorIdFromEndpoint(entry?.endpoint ?? fallbackEndpoint)
}

/** Enabled model rows for the picker (live catalogue, then sync fallback). */
export function chatHostPickerModels(opts: {
  cliHost: CliHostKind | null | undefined
  accountId?: string | null
  catalog: Record<string, CatalogEntry>
  customModels: string[]
  defaultModel: string | null | undefined
  disabledAgentModels: Record<string, string[]> | null | undefined
  apiEndpoint?: string
}): { vendorId: string | null; list: ModelOption[] } {
  const vendorId =
    opts.cliHost == null
      ? builtinCatalogVendorId(opts.catalog, opts.accountId, opts.apiEndpoint)
      : null
  const key = agentModelHostKey(opts.cliHost, vendorId, opts.accountId)
  const entry = opts.catalog[key]
  const raw =
    entry?.models && entry.models.length > 0
      ? entry.models
      : modelsForChatHost(opts.cliHost, opts.customModels, opts.defaultModel, vendorId)
  return {
    vendorId,
    list: filterEnabledModels(
      opts.cliHost,
      raw,
      opts.disabledAgentModels,
      vendorId,
      opts.accountId
    )
  }
}

/** Coerce the stored model onto a valid id for this host / catalogue. */
export function coercedChatHostModel(opts: {
  host: CliHostKind | null | undefined
  currentModel: string | null | undefined
  customModels: string[]
  vavDefaultModel: string | null | undefined
  defaultAgentModels?: Record<string, string> | null
  catalogue?: ModelOption[] | null
  catalog?: Record<string, Pick<AgentModelCatalogEntry, 'models'>>
  vendorId?: string | null
  accountId?: string | null
}): string {
  const catalogue =
    opts.catalogue !== undefined
      ? opts.catalogue
      : (opts.catalog?.[agentModelHostKey(opts.host, opts.vendorId, opts.accountId)]?.models ??
        null)
  return resolveModelForChatHost(opts.host, opts.currentModel, {
    customModels: opts.customModels,
    vavDefaultModel: opts.vavDefaultModel,
    hostDefaultModel: defaultModelForChatHost(opts.host, {
      defaultModel: opts.vavDefaultModel,
      defaultAgentModels: opts.defaultAgentModels
    }),
    catalogue,
    vendorId: opts.catalogue !== undefined ? opts.vendorId : undefined
  })
}

/** Cycle the enabled model list (picker ↑/↓). Null when there is nothing to step. */
export function nextSteppedModelId(
  list: Array<{ id: string }>,
  activeModel: string,
  delta: number
): string | null {
  if (list.length <= 1) return null
  const index = list.findIndex((model) => model.id === activeModel)
  if (index === -1) return list[0]?.id ?? null
  return list[(index + delta + list.length) % list.length]?.id ?? null
}
