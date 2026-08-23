/** Reject if `work` does not settle in `ms`. The original promise keeps running. */
export function withTimeout<T>(work: Promise<T>, ms: number, label = 'timeout'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), ms)
  })
  return Promise.race([work, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

export async function raceSettle<T>(
  work: Promise<T>,
  ms: number
): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
  try {
    const value = await withTimeout(work, ms, 'timeout')
    return { timedOut: false, value }
  } catch (err) {
    if (err instanceof Error && err.message === 'timeout') return { timedOut: true }
    throw err
  }
}
