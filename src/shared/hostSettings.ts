import type { AppSettings } from './types.ts'
import {
  isLocalMachine,
  normalizeMachineId,
  parseWorkspaceRefList,
  recentsForMachine,
  workspaceRef,
  workspaceRefKey,
  type WorkspaceRef
} from './workspaceHost.ts'

/**
 * Settings that live on vavd (turns, new sessions, trays). Appearance, fonts,
 * hotkeys, and window chrome stay on the client.
 */
export const HOST_SETTINGS_KEYS = [
  'apiEndpoint',
  'defaultModel',
  'defaultApprovalMode',
  'defaultThinkingLevel',
  'customModels',
  'maxTokens',
  'defaultWorkingDirectory',
  'commandTimeout',
  'autoApproveReadonly',
  'webToolsEnabled',
  'webSearchEnabled',
  'webFetchEnabled',
  'webTimeoutMs',
  'webSearchProvider',
  'webSearxngBaseUrl',
  'webFetchAllowRender',
  'vercelProjectId',
  'vercelTrayEnabled',
  'cloudflareAccountId',
  'cloudflareTrayEnabled',
  'supabaseProjectRef',
  'supabaseTrayEnabled',
  'githubTrayEnabled',
  'swarmModeEnabled',
  'favoriteConversationIds',
  'recentWorkspaceDirectories',
  'pinnedWorkspaceDirectories',
  'cliAgents',
  'removedCliAgentIds',
  'providerListOrder',
  'defaultAgentId',
  'skipCliAgentPickerWhenSingle',
  'disabledAgentModels',
  'defaultAgentModels',
  'recentAgentModels',
  'logRetentionDays'
] as const satisfies ReadonlyArray<keyof AppSettings>

export type HostSettingsKey = (typeof HOST_SETTINGS_KEYS)[number]
export type HostSettingsPatch = Partial<Pick<AppSettings, HostSettingsKey>>

const HOST_KEY_SET = new Set<string>(HOST_SETTINGS_KEYS)

export function isHostSettingsKey(key: string): key is HostSettingsKey {
  return HOST_KEY_SET.has(key)
}

export function pickHostSettings(source: Partial<AppSettings> | null | undefined): HostSettingsPatch {
  const out: HostSettingsPatch = {}
  if (!source) return out
  for (const key of HOST_SETTINGS_KEYS) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      ;(out as Record<string, unknown>)[key] = source[key]
    }
  }
  return out
}

export function omitHostSettings(source: Partial<AppSettings> | null | undefined): Partial<AppSettings> {
  const out: Partial<AppSettings> = {}
  if (!source) return out
  for (const [key, value] of Object.entries(source)) {
    if (!isHostSettingsKey(key)) (out as Record<string, unknown>)[key] = value
  }
  return out
}

export function mergeHostSettings(local: AppSettings, host: HostSettingsPatch): AppSettings {
  return { ...local, ...host }
}

/**
 * Remote vavd stores recents as `local`. On this desktop they belong to the
 * paired machine id (the same remap `pullHostCatalog` applies).
 */
export function remapHostWorkspaceSettings(
  patch: HostSettingsPatch,
  machineId: string,
  direction: 'fromHost' | 'toHost' = 'fromHost'
): HostSettingsPatch {
  if (isLocalMachine(machineId) || !('recentWorkspaceDirectories' in patch)) return patch
  const recents = parseWorkspaceRefList(patch.recentWorkspaceDirectories)
  const mapped: WorkspaceRef[] = recents.map((ref) => {
    if (direction === 'fromHost') {
      return isLocalMachine(ref.machineId) ? workspaceRef(ref.path, machineId) : ref
    }
    return normalizeMachineId(ref.machineId) === normalizeMachineId(machineId)
      ? workspaceRef(ref.path)
      : ref
  })
  return { ...patch, recentWorkspaceDirectories: mapped }
}

/** Keep catalog-adopted recents the host snapshot omitted or emptied. */
export function retainAdoptedHostRecents(
  merged: AppSettings,
  local: AppSettings,
  machineId: string
): AppSettings {
  if (isLocalMachine(machineId)) return merged
  const adopted = recentsForMachine(
    parseWorkspaceRefList(local.recentWorkspaceDirectories),
    machineId
  )
  if (!adopted.length) return merged
  const next = parseWorkspaceRefList(merged.recentWorkspaceDirectories)
  const seen = new Set(next.map(workspaceRefKey))
  let extra = false
  for (const ref of adopted) {
    if (seen.has(workspaceRefKey(ref))) continue
    next.push(ref)
    extra = true
  }
  return extra ? { ...merged, recentWorkspaceDirectories: next } : merged
}

export function composeHostSettings(
  local: AppSettings,
  hostSnap: Partial<AppSettings> | null | undefined,
  machineId: string
): AppSettings {
  const remapped = remapHostWorkspaceSettings(pickHostSettings(hostSnap), machineId, 'fromHost')
  return retainAdoptedHostRecents(mergeHostSettings(local, remapped), local, machineId)
}

/** Derived secret flags from vavd — not persisted host prefs. */
export const SECRET_PRESENT_KEYS = [
  'apiKeyPresent',
  'braveSearchKeyPresent',
  'cloudflareApiTokenPresent',
  'supabaseAccessTokenPresent',
  'vercelApiTokenPresent'
] as const

export function pickSecretPresent(
  source: Partial<AppSettings> | Record<string, unknown> | null | undefined
): Partial<AppSettings> {
  const out: Partial<AppSettings> = {}
  if (!source) return out
  for (const key of SECRET_PRESENT_KEYS) {
    if (typeof source[key] === 'boolean') (out as Record<string, unknown>)[key] = source[key]
  }
  return out
}
