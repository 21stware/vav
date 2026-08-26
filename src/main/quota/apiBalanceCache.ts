import type { AnalysisApiBalance } from '../../shared/apiBalance.ts'
import { apiBalanceUrl, deepseekBalanceUrl, openrouterCreditsUrl } from '../../shared/apiBalance.ts'
import { fetchDeepSeekApiBalance } from './deepseekBalance.ts'
import { fetchOpenRouterApiBalance } from './openrouterBalance.ts'

const cache = new Map<string, AnalysisApiBalance>()

export function cachedApiBalance(accountId: string): AnalysisApiBalance | null {
  return cache.get(accountId) ?? null
}

export function clearApiBalance(accountId: string): void {
  cache.delete(accountId)
}

export async function fetchApiBalance(input: {
  apiKey: string | null | undefined
  endpoint: string
  force?: boolean
}): Promise<AnalysisApiBalance | null> {
  if (deepseekBalanceUrl(input.endpoint)) {
    return fetchDeepSeekApiBalance(input)
  }
  if (openrouterCreditsUrl(input.endpoint)) {
    return fetchOpenRouterApiBalance(input)
  }
  return null
}

export async function refreshApiBalance(input: {
  accountId: string
  apiKey: string | null | undefined
  endpoint: string
  force?: boolean
}): Promise<AnalysisApiBalance | null> {
  if (!input.apiKey?.trim() || !apiBalanceUrl(input.endpoint)) {
    cache.delete(input.accountId)
    return null
  }
  const value = await fetchApiBalance({
    apiKey: input.apiKey,
    endpoint: input.endpoint,
    force: input.force
  })
  if (value) cache.set(input.accountId, value)
  else cache.delete(input.accountId)
  return value
}
