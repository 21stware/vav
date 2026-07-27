import { useSyncExternalStore } from 'react'
import { getProjection } from '../state/StreamProjection'
import { MarkdownView } from './MarkdownView'
import { ReasoningBlock } from './ReasoningBlock'
import { StreamStatus } from './StreamStatus'
import { ToolCard } from './ToolCard'

/**
 * The live assistant message.
 *
 * Subscribes to the conversation's {@link StreamProjection} rather than the
 * session store, so an 80 ms tick re-renders only this subtree. Sealed chunks
 * are memoised by identity; only the trailing open chunk is re-parsed.
 */
import { useT } from '../i18n/useT'

export function StreamingMessage({ conversationId }: { conversationId: string }): React.JSX.Element | null {
  const t = useT()
  const projection = getProjection(conversationId)
  const snapshot = useSyncExternalStore(projection.subscribe, projection.getSnapshot)

  if (!snapshot.active) return null
  const awaiting = snapshot.phase === 'awaiting-user'
  const live =
    snapshot.phase === 'outputting' ||
    snapshot.phase === 'thinking' ||
    snapshot.phase === 'working'

  return (
    <div className="message-turn assistant">
      <div className="message-role">Agent</div>
      <div className="message assistant">
        {snapshot.blocks.map((block) => {
          if (block.kind === 'reasoning') {
            return <ReasoningBlock key={block.key} text={block.text} />
          }
          if (block.kind === 'tool') {
            if (block.block.tool === 'plan') return null
            return <ToolCard key={block.key} block={block.block} />
          }

          return (
            <div key={block.key}>
              {block.sealed.map((chunk, index) => (
                <MarkdownView key={`${block.key}-${index}`} source={chunk} />
              ))}
              {block.tail && <MarkdownView source={block.tail} cached={false} />}
            </div>
          )
        })}

        {awaiting && <div className="muted tiny">{t('transcript.awaitingContinue')}</div>}
        {live && <StreamStatus state="outputting" />}
      </div>
    </div>
  )
}
