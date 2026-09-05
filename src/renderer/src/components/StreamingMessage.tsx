import { useSyncExternalStore } from 'react'
import type { MessageBlock } from '@shared/types'
import {
  processThoughtMs,
  splitLiveAssistantProcess,
  type IndexedBlock
} from '../lib/assistantProcess'
import { getProjection, type StreamBlock } from '../state/StreamProjection'
import { streamStatusState } from '../lib/streamStatus'
import { isLiveStreamPhase } from '@shared/turnRecovery'
import { useT } from '../i18n/useT'
import { handleMarkdownOverlayDoubleClick, MarkdownView } from './MarkdownView'
import { ReasoningBlock } from './ReasoningBlock'
import { StreamStatus } from './StreamStatus'
import { ThinkingProcess } from './ThinkingProcess'
import { ToolCard } from './ToolCard'

function streamAsMessage(block: StreamBlock): MessageBlock {
  if (block.kind === 'reasoning') {
    return { kind: 'reasoning', text: block.text, durationMs: block.durationMs }
  }
  if (block.kind === 'tool') return block.block
  return { kind: 'text', text: `${block.sealed.join('')}${block.tail}` }
}

/**
 * The live assistant message.
 *
 * Subscribes to the conversation's {@link StreamProjection} rather than the
 * session store, so an 80 ms tick re-renders only this subtree. Sealed chunks
 * are memoised by identity; only the trailing open chunk is re-parsed.
 */
export function StreamingMessage({ conversationId }: { conversationId: string }): React.JSX.Element | null {
  const t = useT()
  const projection = getProjection(conversationId)
  const snapshot = useSyncExternalStore(projection.subscribe, projection.getSnapshot)

  if (!snapshot.active) return null
  const awaiting = snapshot.phase === 'awaiting-user'
  const live = isLiveStreamPhase(snapshot.phase)

  const { process, live: tail } = splitLiveAssistantProcess(snapshot.blocks.map(streamAsMessage))

  const renderLive = (item: IndexedBlock): React.JSX.Element | null => {
    const block = snapshot.blocks[item.index]
    if (!block) return null
    if (block.kind === 'reasoning') {
      const active = snapshot.phase === 'thinking' && item.index === snapshot.blocks.length - 1
      return (
        <ReasoningBlock
          key={block.key}
          text={block.text}
          live={active}
          durationMs={block.durationMs}
        />
      )
    }
    if (block.kind === 'tool') {
      if (block.block.tool === 'plan') return null
      return <ToolCard key={block.key} block={block.block} />
    }
    return (
      <div
        key={block.key}
        className="markdown"
        onDoubleClick={handleMarkdownOverlayDoubleClick}
      >
        {block.sealed.map((chunk, index) => (
          <MarkdownView key={`${block.key}-${index}`} source={chunk} fragment />
        ))}
        {block.tail && <MarkdownView source={block.tail} cached={false} fragment />}
      </div>
    )
  }

  const renderFolded = (item: IndexedBlock): React.JSX.Element | null => {
    const { block, index } = item
    if (block.kind === 'reasoning') {
      return <ReasoningBlock key={`r${index}`} text={block.text} flat />
    }
    if (block.kind === 'toolCall') {
      return <ToolCard key={block.id} block={block} startCollapsed />
    }
    if (block.kind === 'text') {
      return <MarkdownView key={`t${index}`} source={block.text} />
    }
    return null
  }

  return (
    <div className="message-turn assistant" data-testid="streaming-message">
      <div className="message-role">{t('message.roleAgent')}</div>
      <div className="message assistant">
        {process.length > 0 ? (
          <>
            <ThinkingProcess
              steps={process.length}
              durationMs={processThoughtMs(process)}
              collapseOnMount
            >
              {process.map(renderFolded)}
            </ThinkingProcess>
            {tail.map(renderLive)}
          </>
        ) : (
          snapshot.blocks.map((_, index) =>
            renderLive({ block: streamAsMessage(snapshot.blocks[index]!), index })
          )
        )}

        {awaiting && <div className="muted tiny">{t('transcript.awaitingContinue')}</div>}
        {live && (
          <StreamStatus
            state={streamStatusState(snapshot.phase)}
            conversationId={conversationId}
            recovery={snapshot.recovery}
          />
        )}
      </div>
    </div>
  )
}
