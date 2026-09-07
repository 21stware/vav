import type { TurnEvent } from '../../shared/types.ts'
import type { AppLocale } from '../../shared/i18n/index.ts'
import type { RemoteThreadBlock } from '../../shared/remoteControl.ts'
import { projectRemotePlan, projectRemoteToolBlock } from '../../shared/remoteThread.ts'

export type RemoteTurnSink = {
  beginLive(conversationId: string): void
  appendLive(
    conversationId: string,
    index: number,
    kind: 'text' | 'reasoning',
    text: string,
    replace?: boolean
  ): void
  setLiveBlock(conversationId: string, index: number, block: RemoteThreadBlock): void
  setLiveRecovery?(
    conversationId: string,
    recovery: { kind: 'retrying' | 'reconnecting' | 'healing'; attempt: number; limit: number }
  ): void
  flushThread?(conversationId: string): void
  finishTurn(
    conversationId: string,
    status: 'cancelled' | 'error' | 'done',
    error?: string
  ): void
}

/** Mirror a desktop turn onto the phone companion live thread. */
export function fanRemoteTurn(event: TurnEvent, remote: RemoteTurnSink, locale: AppLocale): void {
  switch (event.type) {
    case 'user':
      remote.flushThread?.(event.conversationId)
      return
    case 'start':
      remote.beginLive(event.conversationId)
      return
    case 'delta':
      if (event.kind === 'text' || event.kind === 'reasoning') {
        remote.appendLive(
          event.conversationId,
          event.index,
          event.kind,
          event.text,
          event.replace === true
        )
      }
      return
    case 'tool':
      remote.setLiveBlock(
        event.conversationId,
        event.index,
        projectRemoteToolBlock(event.block, locale)
      )
      return
    case 'plan':
      remote.setLiveBlock(event.conversationId, event.index, projectRemotePlan(event.block))
      return
    case 'awaiting': {
      const block = projectRemoteToolBlock(event.block, locale)
      remote.setLiveBlock(event.conversationId, event.index, block)
      return
    }
    case 'phase': {
      if (
        event.phase === 'healing' ||
        event.phase === 'retrying' ||
        event.phase === 'reconnecting'
      ) {
        remote.setLiveRecovery?.(event.conversationId, {
          kind: event.phase,
          attempt: event.recovery?.attempt ?? 1,
          limit: event.recovery?.limit ?? 1
        })
      }
      return
    }
    case 'end':
      remote.finishTurn(
        event.conversationId,
        event.cancelled ? 'cancelled' : event.error ? 'error' : 'done',
        event.error
      )
      return
    default:
      return
  }
}
