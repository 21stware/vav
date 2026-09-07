import { pickHostSettings, pickSecretPresent, type HostSettingsPatch } from '../../shared/hostSettings.ts'
import type { AppSettings } from '../../shared/types.ts'
import type { SecretName } from '../store/SecretStore.ts'
import type { SettingsStore } from '../store/SettingsStore.ts'
import type { DaemonSettingsCatalog } from './DaemonServer.ts'

const SECRET_SLOTS: SecretName[] = [
  'api',
  'braveSearch',
  'tinyfish',
  'cloudflare',
  'supabase',
  'vercel'
]

export type SettingsSecretVault = {
  has: (slot: SecretName) => boolean
  set: (value: string, slot: SecretName) => void
  clear: (slot: SecretName) => void
  get: (slot: SecretName) => string | null
  maskedHint: (slot: SecretName) => string | null
}

function asSlot(raw: string): SecretName | null {
  return SECRET_SLOTS.includes(raw as SecretName) ? (raw as SecretName) : null
}

function presentOf(
  secrets: SettingsSecretVault | undefined,
  hasVavKey?: () => boolean
): Record<string, boolean> {
  return {
    apiKeyPresent: (secrets?.has('api') ?? false) || hasVavKey?.() === true,
    braveSearchKeyPresent: secrets?.has('braveSearch') ?? false,
    cloudflareApiTokenPresent: secrets?.has('cloudflare') ?? false,
    supabaseAccessTokenPresent: secrets?.has('supabase') ?? false,
    vercelApiTokenPresent: secrets?.has('vercel') ?? false
  }
}

export function vavAccountKeyPresent(
  accounts: { listAll(): Array<{ id: string; kind: string }> },
  secrets: { hasAccountKey(id: string): boolean }
): boolean {
  return accounts.listAll().some((row) => row.kind === 'vav_key' && secrets.hasAccountKey(row.id))
}

export function createSettingsCatalog(
  settings: SettingsStore,
  secrets?: SettingsSecretVault,
  extras?: { hasVavKey?: () => boolean }
): DaemonSettingsCatalog {
  const pageOf = () => ({
    ...pickHostSettings(settings.get()),
    ...presentOf(secrets, extras?.hasVavKey)
  })
  return {
    get: () => pageOf(),
    update: (patch) => {
      const next = settings.update(pickHostSettings(patch as Partial<AppSettings>))
      return { ...pickHostSettings(next), ...presentOf(secrets, extras?.hasVavKey) }
    },
    reset: () => {
      if (secrets) {
        for (const slot of SECRET_SLOTS) secrets.clear(slot)
      }
      return { ...pickHostSettings(settings.reset()), ...presentOf(secrets, extras?.hasVavKey) }
    },
    setSecret: (slot, value) => {
      const name = asSlot(slot)
      if (!name || !secrets) {
        return { hint: null, ...pickSecretPresent(presentOf(secrets, extras?.hasVavKey)) }
      }
      secrets.set(value, name)
      return { hint: secrets.maskedHint(name), ...presentOf(secrets, extras?.hasVavKey) }
    },
    secretHint: (slot) => {
      const name = asSlot(slot)
      return name && secrets ? secrets.maskedHint(name) : null
    },
    revealSecret: (slot) => {
      const name = asSlot(slot)
      return name && secrets ? secrets.get(name) : null
    }
  }
}

export type { HostSettingsPatch }
