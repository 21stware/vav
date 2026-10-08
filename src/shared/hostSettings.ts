import type { AppSettings } from './types.ts'
import {
  isLocalMachine,
  normalizeMachineId,
  parseWorkspaceRefList,
  workspaceRef,
  workspaceRefKey,
  type WorkspaceRef
} from './workspaceHost.ts'

/**
 * Settings that live on vav-server (turns, new sessions, trays). Appearance, fonts,
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
  'cloudflareAccountId',
  'supabaseProjectRef',
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
 * Remote vav-server stores recents as `local`. On this desktop they belong to the
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
  _machineId: string
): AppSettings {
  // A freshly spawned / empty vav-server must not clobber the desktop cache —
  // that is what made folder history vanish after every app update.
  const adopted = parseWorkspaceRefList(local.recentWorkspaceDirectories)
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

/**
 * Agent edits made before the local vav-server attached land only in the
 * desktop store. A host that never had an agent removed still carries the
 * full built-in catalogue, so adopting it on attach re-added every agent the
 * user had deleted. Returns the desktop list to push, or null to keep the host's.
 */
export function agentListSeedFromDesktop(
  hostSnap: Partial<AppSettings> | null | undefined,
  desktop: Partial<AppSettings>
): HostSettingsPatch | null {
  const desktopRemoved = desktop.removedCliAgentIds ?? []
  const hostRemoved = hostSnap?.removedCliAgentIds ?? []
  if (!desktopRemoved.length || hostRemoved.length) return null
  if (!Array.isArray(desktop.cliAgents) || desktop.cliAgents.length === 0) return null
  const hostIds = new Set((hostSnap?.cliAgents ?? []).map((agent) => agent.id))
  if (!desktopRemoved.some((id) => hostIds.has(id))) return null
  return { cliAgents: desktop.cliAgents, removedCliAgentIds: desktopRemoved }
}

/** Derived secret flags from vav-server — not persisted host prefs. */
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
