import type { AnalysisApiBalance } from '../../shared/apiBalance.ts'
import { deepseekBalanceUrl } from '../../shared/apiBalance.ts'
import { fetchDeepSeekApiBalance } from './deepseekBalance.ts'

const cache = new Map<string, AnalysisApiBalance>()

export function cachedApiBalance(accountId: string): AnalysisApiBalance | null {
  return cache.get(accountId) ?? null
}

export function clearApiBalance(accountId: string): void {
  cache.delete(accountId)
}

export async function refreshApiBalance(input: {
  accountId: string
  apiKey: string | null | undefined
  endpoint: string
  force?: boolean
}): Promise<AnalysisApiBalance | null> {
  if (!input.apiKey?.trim() || !deepseekBalanceUrl(input.endpoint)) {
    cache.delete(input.accountId)
    return null
  }
  const value = await fetchDeepSeekApiBalance({
    apiKey: input.apiKey,
    endpoint: input.endpoint,
    force: input.force
  })
  if (value) cache.set(input.accountId, value)
  else cache.delete(input.accountId)
  return value
}
