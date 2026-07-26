import { useSyncExternalStore } from 'react'
import { getProjection } from '../state/StreamProjection'
import { MarkdownView } from './MarkdownView'
import { ToolCard } from './ToolCard'

/**
 * The live assistant message.
 *
 * Subscribes to the conversation's {@link StreamProjection} rather than the
 * session store, so an 80 ms tick re-renders only this subtree. Sealed chunks
 * are memoised by identity; only the trailing open chunk is re-parsed.
 */
export function StreamingMessage({ conversationId }: { conversationId: string }): React.JSX.Element | null {
  const projection = getProjection(conversationId)
  const snapshot = useSyncExternalStore(projection.subscribe, projection.getSnapshot)

  if (!snapshot.active) return null
  const showCaret = snapshot.phase === 'outputting' || snapshot.phase === 'thinking'

  return (
    <div className="message assistant">
      {snapshot.blocks.length === 0 && (
        <div className="muted">
          Agent 正在思考…
          <span className="typing-dot" />
        </div>
      )}

      {snapshot.blocks.map((block, blockIndex) => {
        if (block.kind === 'reasoning') {
          return (
            <details className="reasoning" key={block.key} open>
              <summary>思考中…</summary>
              <div className="reasoning-body">{block.text}</div>
            </details>
          )
        }
        if (block.kind === 'tool') {
          return <ToolCard key={block.key} block={block.block} />
        }

        const isLastBlock = blockIndex === snapshot.blocks.length - 1
        return (
          <div key={block.key}>
            {block.sealed.map((chunk, index) => (
              <MarkdownView key={`${block.key}-${index}`} source={chunk} />
            ))}
            {block.tail && <MarkdownView source={block.tail} cached={false} />}
            {isLastBlock && showCaret && <span className="typing-dot" />}
          </div>
        )
      })}

      {snapshot.phase === 'awaiting-user' && (
        <div className="muted tiny">等待你的回答后继续…</div>
      )}
    </div>
  )
}
