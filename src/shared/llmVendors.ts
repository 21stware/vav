/**
 * LLM API vendors harnessed by VAV (DeepSeek, OpenRouter, …).
 * Distinct from CLI agents — same chat host (`null`), different endpoints.
 */

export type LlmVendorId =
  | 'deepseek'
  | 'openrouter'
  | 'openai'
  | 'anthropic'
  | 'xai'
  | 'google'
  | 'together'
  | 'siliconflow'
  | 'bigmodel'
  | 'kimi'
  | 'custom'

export interface LlmVendor {
  id: LlmVendorId
  name: string
  /** Official API root. Empty for Custom — the user fills it in. */
  endpoint: string
}

export const LLM_VENDOR_CATALOGUE: readonly LlmVendor[] = [
  { id: 'deepseek', name: 'DeepSeek', endpoint: 'https://api.deepseek.com' },
  { id: 'openrouter', name: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1' },
  { id: 'openai', name: 'OpenAI', endpoint: 'https://api.openai.com/v1' },
  { id: 'anthropic', name: 'Anthropic', endpoint: 'https://api.anthropic.com' },
  { id: 'xai', name: 'xAI', endpoint: 'https://api.x.ai/v1' },
  { id: 'google', name: 'Google', endpoint: 'https://generativelanguage.googleapis.com/v1beta' },
  { id: 'together', name: 'Together', endpoint: 'https://api.together.xyz/v1' },
  { id: 'siliconflow', name: 'SiliconFlow', endpoint: 'https://api.siliconflow.cn/v1' },
  { id: 'bigmodel', name: 'Zhipu', endpoint: 'https://open.bigmodel.cn/api/paas/v4' },
  { id: 'kimi', name: 'Kimi', endpoint: 'https://api.moonshot.cn/v1' }
]

export const LLM_CUSTOM_VENDOR: LlmVendor = {
  id: 'custom',
  name: 'Custom',
  endpoint: ''
}

const VENDOR_BY_ID = new Map<string, LlmVendor>([
  ...LLM_VENDOR_CATALOGUE.map((vendor) => [vendor.id, vendor] as const),
  [LLM_CUSTOM_VENDOR.id, LLM_CUSTOM_VENDOR]
])

export function isLlmVendorId(id: string | null | undefined): id is LlmVendorId {
  return !!id && VENDOR_BY_ID.has(id)
}

export function vendorById(id: string | null | undefined): LlmVendor | null {
  if (!id) return null
  return VENDOR_BY_ID.get(id) ?? null
}

function endpointHost(endpoint: string | null | undefined): string | null {
  const raw = endpoint?.trim()
  if (!raw) return null
  try {
    return new URL(raw).host || null
  } catch {
    return raw.replace(/^https?:\/\//i, '').split('/')[0] || raw
  }
}

function matchVendor(endpoint: string | null | undefined): LlmVendor | null {
  const host = (endpointHost(endpoint) ?? '').toLowerCase()
  const raw = (endpoint ?? '').toLowerCase()
  if (!host && !raw) return null
  if (host.includes('deepseek') || raw.includes('deepseek')) return vendorById('deepseek')
  if (host.includes('openrouter')) return vendorById('openrouter')
  if (host === 'api.x.ai' || host.endsWith('.x.ai') || raw.includes('api.x.ai')) {
    return vendorById('xai')
  }
  if (host === 'api.openai.com' || host.endsWith('.openai.com')) return vendorById('openai')
  if (host.includes('anthropic')) return vendorById('anthropic')
  if (host.includes('googleapis.com') || host.includes('generativelanguage')) {
    return vendorById('google')
  }
  if (host.includes('together.ai') || host.includes('together.xyz')) return vendorById('together')
  if (host.includes('siliconflow')) return vendorById('siliconflow')
  if (
    host.includes('bigmodel') ||
    host.includes('zhipuai') ||
    host === 'api.z.ai' ||
    host.endsWith('.z.ai')
  ) {
    return vendorById('bigmodel')
  }
  if (host.includes('moonshot') || host === 'api.kimi.com' || host.endsWith('.kimi.com')) {
    return vendorById('kimi')
  }
  return null
}

/** Known vendor for this endpoint, or null when it is custom / empty. */
export function vendorFromEndpoint(endpoint: string | null | undefined): LlmVendor | null {
  return matchVendor(endpoint)
}

/** Always returns a vendor id — unmatched endpoints are `custom`. */
export function vendorIdFromEndpoint(endpoint: string | null | undefined): LlmVendorId {
  return matchVendor(endpoint)?.id ?? 'custom'
}

export function vendorDisplayName(
  endpoint: string | null | undefined,
  fallback = LLM_CUSTOM_VENDOR.name
): string {
  return matchVendor(endpoint)?.name ?? fallback
}

export interface LlmVendorGroup<T> {
  vendor: LlmVendor
  accounts: T[]
}

/** Collapse VAV key accounts into vendor rows, catalogue order then Custom. */
export function groupAccountsByVendor<T extends { endpoint?: string | null }>(
  accounts: T[]
): LlmVendorGroup<T>[] {
  const buckets = new Map<LlmVendorId, T[]>()
  for (const account of accounts) {
    const id = vendorIdFromEndpoint(account.endpoint)
    const list = buckets.get(id)
    if (list) list.push(account)
    else buckets.set(id, [account])
  }
  const out: LlmVendorGroup<T>[] = []
  for (const vendor of LLM_VENDOR_CATALOGUE) {
    const list = buckets.get(vendor.id)
    if (list?.length) out.push({ vendor, accounts: list })
  }
  const custom = buckets.get('custom')
  if (custom?.length) out.push({ vendor: LLM_CUSTOM_VENDOR, accounts: custom })
  return out
}
