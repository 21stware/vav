import {
  createSwarmFinishWatch,
  shouldDeliverSwarmFinishChime,
  type SwarmFinishEffect,
  type SwarmFinishSample
} from '@shared/swarmFinishWatch'

/**
 * Debounced finish chime for Swarm CLI panes. Main owns the timer; the watch
 * only decides when a running → idle edge is a candidate.
 *
 * If the session was in front when it went idle, drop the chime — unfocusing
 * afterwards must not play "turn complete" for a result the user already saw.
 */
export function createSwarmFinishAlert(
  notify: (conversationId: string) => void,
  opts?: {
    isForeground?: (conversationId: string) => boolean
  }
): {
  noteStatus: (sample: SwarmFinishSample) => void
  noteGone: (tabId: string) => void
  dispose: () => void
} {
  const watch = createSwarmFinishWatch()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const isForeground = opts?.isForeground

  function clearTimer(tabId: string): void {
    const timer = timers.get(tabId)
    if (!timer) return
    clearTimeout(timer)
    timers.delete(tabId)
  }

  function apply(effect: SwarmFinishEffect | null): void {
    if (!effect) return
    if (effect.type === 'cancel' || effect.type === 'forget') {
      clearTimer(effect.tabId)
      return
    }
    clearTimer(effect.tabId)
    if (isForeground?.(effect.conversationId)) {
      // Consume the armed edge now so a later unfocus cannot fire it.
      watch.takeNotify(effect.tabId)
      return
    }
    const timer = setTimeout(() => {
      timers.delete(effect.tabId)
      const ready = watch.takeNotify(effect.tabId)
      if (!ready) return
      if (
        !shouldDeliverSwarmFinishChime({
          completedWhileForeground: false,
          foregroundNow: isForeground?.(ready.conversationId) === true
        })
      ) {
        return
      }
      notify(ready.conversationId)
    }, effect.delayMs)
    timer.unref?.()
    timers.set(effect.tabId, timer)
  }

  return {
    noteStatus(sample) {
      apply(watch.noteStatus(sample))
    },
    noteGone(tabId) {
      apply(watch.noteGone(tabId))
    },
    dispose() {
      for (const tabId of [...timers.keys()]) clearTimer(tabId)
    }
  }
}
