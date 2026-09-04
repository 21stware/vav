import type { Conversation, ConversationMeta } from '../../shared/types.ts'

/** Strip transcript bodies and parked host state for sidebar / IPC seed. */
export function conversationToMeta(conversation: Conversation): ConversationMeta {
  const {
    messages: _messages,
    tokenHistory: _history,
    cacheCreatedAt: _created,
    cacheExpiresAt: _expires,
    compactions: _compactions,
    hostTranscripts: _hostTranscripts,
    quotaWindows: _quota,
    cliPaneBindings: _paneBindings,
    ...meta
  } = conversation
  void _messages
  void _history
  void _created
  void _expires
  void _compactions
  void _hostTranscripts
  void _quota
  void _paneBindings
  return meta
}
