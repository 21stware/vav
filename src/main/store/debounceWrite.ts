/** Coalesce bursty sync writes (settings.json) without dropping the last value. */

export function createDebouncedWriter(write: () => void, delayMs: number): {
  schedule: () => void
  flush: () => void
  cancel: () => void
} {
  let timer: ReturnType<typeof setTimeout> | null = null
  let dirty = false
  const run = (): void => {
    timer = null
    if (!dirty) return
    dirty = false
    write()
  }
  return {
    schedule() {
      dirty = true
      if (timer) clearTimeout(timer)
      timer = setTimeout(run, delayMs)
    },
    flush() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      run()
    },
    cancel() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      dirty = false
    }
  }
}
