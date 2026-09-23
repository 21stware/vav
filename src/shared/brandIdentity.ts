/**
 * Build-time product skin. Wire slugs (`vav://`, `window.vav`, agent id `vav`,
 * CLI names, userData unless the pack overrides them) stay stable.
 *
 * Generated values live in `brand.generated.ts` (`scripts/apply-brand-pack.mjs`).
 */
import { BRAND, BRAND_I18N } from './brand.generated.ts'

export type BrandIdentity = {
  slug: string
  displayName: string
  displayNameDev: string
  appId: string
  appIdDev: string
  userDataDir: string
  userDataDirDev: string
  copyright: string
  /** `{product}` and `{os}` are substituted at prompt build time. */
  systemIdentity: string
}

export type BrandI18nOverlays = {
  en?: Record<string, string>
  'zh-CN'?: Record<string, string>
}

export type BrandIdentityFile = Partial<BrandIdentity> & {
  displayName?: string
}

const DEFAULT_SYSTEM_IDENTITY =
  "You are {product}, a local coding agent running on the user's {os} machine."

export const DEFAULT_BRAND: BrandIdentity = {
  slug: 'vav',
  displayName: 'VAV',
  displayNameDev: 'VAV Dev',
  appId: 'com.vav.app',
  appIdDev: 'dev.vav.app',
  userDataDir: 'vav',
  userDataDirDev: 'vav-dev',
  copyright: 'Copyright © VAV',
  systemIdentity: DEFAULT_SYSTEM_IDENTITY
}

export function parseBrandIdentity(value: unknown): BrandIdentity {
  if (typeof value !== 'object' || value === null) return { ...DEFAULT_BRAND }
  const raw = value as Record<string, unknown>
  const text = (key: keyof BrandIdentity, fallback: string): string => {
    const next = raw[key]
    return typeof next === 'string' && next.trim() ? next.trim() : fallback
  }
  return {
    slug: text('slug', DEFAULT_BRAND.slug),
    displayName: text('displayName', DEFAULT_BRAND.displayName),
    displayNameDev: text('displayNameDev', DEFAULT_BRAND.displayNameDev),
    appId: text('appId', DEFAULT_BRAND.appId),
    appIdDev: text('appIdDev', DEFAULT_BRAND.appIdDev),
    userDataDir: text('userDataDir', DEFAULT_BRAND.userDataDir),
    userDataDirDev: text('userDataDirDev', DEFAULT_BRAND.userDataDirDev),
    copyright: text('copyright', DEFAULT_BRAND.copyright),
    systemIdentity: text('systemIdentity', DEFAULT_BRAND.systemIdentity)
  }
}

export function activeBrand(): BrandIdentity {
  return BRAND
}

export function brandDisplayName(): string {
  return BRAND.displayName
}

export function brandI18nOverlays(): BrandI18nOverlays {
  return BRAND_I18N
}

/** Swap the standalone product word. Leaves `vav-server` / `vav://` alone. */
export function applyProductName(text: string, displayName = BRAND.displayName): string {
  if (!text || displayName === 'VAV') return text
  return text.replace(/\bVAV\b/g, displayName)
}

export function formatSystemIdentity(
  osDisplay: string,
  brand: BrandIdentity = BRAND
): string {
  return brand.systemIdentity
    .replaceAll('{product}', brand.displayName)
    .replaceAll('{os}', osDisplay)
}

export function brandI18nOverlay(
  locale: 'en' | 'zh-CN',
  key: string
): string | undefined {
  return BRAND_I18N[locale]?.[key]
}
