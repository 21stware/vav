import type { TurnPhase, TurnRecovery } from '@shared/types'
import { isRecoveryPhase } from '@shared/turnRecovery'

export type StreamStatusState = 'outputting' | 'retrying' | 'reconnecting' | 'healing' | 'done'

export function streamStatusState(phase: TurnPhase): StreamStatusState {
  if (isRecoveryPhase(phase)) return phase
  return 'outputting'
}

export function streamStatusLabel(
  state: StreamStatusState,
  labels: {
    outputting: string
    retry: string
    reconnect: string
    heal: string
    progress: (label: string, attempt: number, limit: number) => string
  },
  recovery?: TurnRecovery | null
): string {
  const base =
    state === 'retrying'
      ? labels.retry
      : state === 'reconnecting'
        ? labels.reconnect
        : state === 'healing'
          ? labels.heal
          : labels.outputting
  if (
    recovery &&
    (state === 'retrying' || state === 'reconnecting') &&
    recovery.limit > 1
  ) {
    return labels.progress(base, recovery.attempt, recovery.limit)
  }
  return base
}
