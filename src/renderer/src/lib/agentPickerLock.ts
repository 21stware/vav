import type { ChatMessage } from '@shared/types'

/**
 * Agent is bound once this conversation has a transcript.
 *
 * `undefined` means messages are not hydrated yet — treat as locked so a
 * used session does not flash the pre-send (full provider) picker.
 * New sessions seed `[]` on create, so they stay unlocked until the first
 * user turn lands.
 */
export function isAgentPickerLocked(messages: ChatMessage[] | undefined): boolean {
  return messages === undefined || messages.length > 0
}
