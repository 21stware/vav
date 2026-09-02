/** Drop one conversation's live token overlay without cloning when it is absent. */
export function omitLiveUsage<T>(
  liveUsage: Record<string, T>,
  id: string
): Record<string, T> {
  if (!(id in liveUsage)) return liveUsage
  const { [id]: _removed, ...rest } = liveUsage
  return rest
}
