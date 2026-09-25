export type KnowledgeNotePaintSource = 'disk' | 'agent'

export type KnowledgeNotePaintPhase = 'loading' | 'ready' | 'error' | 'conflicted' | 'destroyed'

export type KnowledgeNotePaintAction = 'ignore' | 'ack' | 'apply' | 'conflict'

/**
 * Decide how an incoming note body should land in the open editor.
 *
 * Autosave writes the open note, then `knowledgeChanged` echoes that same
 * body back. While the user is still typing, that echo is not a remote edit —
 * treating it as one flashes the conflict banner on every debounce.
 */
export function decideKnowledgeNotePaint(input: {
  incoming: string
  current: string
  lastSaved: string
  localDirty: boolean
  source: KnowledgeNotePaintSource
  phase: KnowledgeNotePaintPhase
}): KnowledgeNotePaintAction {
  if (input.phase === 'destroyed' || input.phase === 'error' || input.phase === 'loading') {
    return 'ignore'
  }
  if (input.incoming === input.lastSaved) return 'ignore'
  if (input.incoming === input.current) return 'ack'
  if (input.phase === 'conflicted') return input.source === 'agent' ? 'apply' : 'ignore'
  if (input.localDirty) return 'conflict'
  return 'apply'
}
