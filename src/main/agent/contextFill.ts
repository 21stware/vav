/** Whether a CLI turn without provider usage should fill the ring from the transcript. */
export function estimatedContextFill(opts: {
  sawUsage: boolean
  cancelled: boolean
  historyLength: number
  estimate: number
  tokensUsed: number
}): number | null {
  if (opts.sawUsage || opts.cancelled) return null
  if (opts.historyLength > 0) return null
  if (opts.estimate <= 0 || opts.estimate === opts.tokensUsed) return null
  return opts.estimate
}
