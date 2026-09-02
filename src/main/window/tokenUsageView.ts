/** Lean token-usage panel math — never ships message bodies. */

export function resolveContextTokens(
  estimated: number,
  latestInput: number,
  tokensUsed: number
): { contextTokens: number; contextTokensEstimated: boolean } {
  const contextTokens = estimated > 0 ? estimated : latestInput > 0 ? latestInput : tokensUsed
  return { contextTokens, contextTokensEstimated: estimated > 0 }
}
