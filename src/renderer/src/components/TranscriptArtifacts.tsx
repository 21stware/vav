import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  File,
  FileArchive,
  FileCode,
  FileSpreadsheet,
  FileText,
  Film,
  Globe,
  Image,
  Music
} from 'lucide-react'
import {
  collectConversationArtifacts,
  partitionConversationArtifacts,
  writeToolPath,
  type ConversationArtifact,
  type ConversationArtifactTone
} from '@shared/conversationArtifacts'
import type { ChatMessage, MessageBlock } from '@shared/types'
import { formatBadge } from '../lib/previewBlocks'
import { showMenu } from '../lib/nativeMenu'
import { fileManagerLabel } from '../lib/platform'
import { openConversationFile, revealSessionFileInFinder } from '../lib/openSessionFile'
import { getProjection } from '../state/StreamProjection'
import { useSessionStore } from '../state/sessionStore'
import { useT } from '../i18n/useT'

const TONE_ICON: Record<ConversationArtifactTone, typeof FileText> = {
  html: Globe,
  document: FileText,
  image: Image,
  audio: Music,
  video: Film,
  data: FileSpreadsheet,
  code: FileCode,
  archive: FileArchive,
  other: File
}

const EMPTY_LIVE: MessageBlock[] = []
const liveCache = new Map<string, { sig: string; blocks: MessageBlock[] }>()

/** Stable write-tool snapshot — new array only when paths / status change. */
function liveWriteBlocks(conversationId: string): MessageBlock[] {
  const snapshot = getProjection(conversationId).getSnapshot()
  if (!snapshot.active) {
    liveCache.delete(conversationId)
    return EMPTY_LIVE
  }
  const blocks: MessageBlock[] = []
  const parts: string[] = []
  for (const block of snapshot.blocks) {
    if (block.kind !== 'tool') continue
    const path = writeToolPath(block.block.tool, block.block.input)
    if (!path) continue
    blocks.push(block.block)
    parts.push(`${block.block.id}:${block.block.status}:${path}`)
  }
  const sig = parts.join('|')
  const prev = liveCache.get(conversationId)
  if (prev && prev.sig === sig) return prev.blocks
  const next = { sig, blocks: blocks.length ? blocks : EMPTY_LIVE }
  liveCache.set(conversationId, next)
  return next.blocks
}

function ArtifactIcon({ tone }: { tone: ConversationArtifactTone }): ReactNode {
  const Icon = TONE_ICON[tone]
  return <Icon size={14} strokeWidth={1.75} aria-hidden />
}

function ArtifactRow({
  item,
  onOpen
}: {
  item: ConversationArtifact
  onOpen: (path: string) => void
}): React.JSX.Element {
  const t = useT()
  const badge = formatBadge(item.path, item.previewKind)
  return (
    <li>
      <button
        type="button"
        className="transcript-artifact"
        data-testid="transcript-artifact"
        data-draft={item.draft ? 'true' : undefined}
        data-tone={item.tone}
        title={item.relativePath}
        onClick={() => onOpen(item.path)}
        onContextMenu={(event) => {
          event.preventDefault()
          void showMenu(
            [
              { label: t('artifacts.open'), onSelect: () => onOpen(item.path) },
              {
                label: t('files.reveal', { fileManager: fileManagerLabel() }),
                onSelect: () => revealSessionFileInFinder(item.path)
              },
              {
                label: t('files.copyPath'),
                onSelect: () => void window.vav.conversations.copyToClipboard(item.path)
              }
            ],
            { x: event.clientX, y: event.clientY }
          )
        }}
      >
        <span className="transcript-artifact-icon">
          <ArtifactIcon tone={item.tone} />
        </span>
        <span className="transcript-artifact-copy">
          <span className="transcript-artifact-name">{item.name}</span>
          {item.relativePath !== item.name ? (
            <span className="transcript-artifact-path">{item.relativePath}</span>
          ) : null}
        </span>
        <span className="transcript-artifact-meta">
          {item.draft ? t('artifacts.writing') : badge}
        </span>
      </button>
    </li>
  )
}

export function TranscriptArtifacts({
  conversationId,
  messages
}: {
  conversationId: string
  messages: ChatMessage[]
}): React.JSX.Element | null {
  const t = useT()
  const workdir = useSessionStore(
    (s) => s.conversations.find((c) => c.id === conversationId)?.workingDirectory ?? null
  )
  const changeSetsById = useSessionStore((s) => s.changeSetsById)
  const projection = getProjection(conversationId)
  const liveBlocks = useSyncExternalStore(projection.subscribe, () => liveWriteBlocks(conversationId))
  const [expanded, setExpanded] = useState(false)

  const artifacts = useMemo(
    () =>
      collectConversationArtifacts({
        messages,
        workdir,
        changeSetsById,
        liveBlocks
      }),
    [messages, workdir, changeSetsById, liveBlocks]
  )
  const { pinned, extra } = useMemo(
    () => partitionConversationArtifacts(artifacts),
    [artifacts]
  )
  const shown = expanded ? [...pinned, ...extra] : pinned

  if (artifacts.length === 0) return null

  return (
    <section
      className="transcript-artifacts"
      data-testid="transcript-artifacts"
      aria-label={t('artifacts.title')}
    >
      <header className="transcript-artifacts-head">
        <span className="transcript-artifacts-title">{t('artifacts.title')}</span>
        <span className="transcript-artifacts-count">{artifacts.length}</span>
      </header>
      <ul className="transcript-artifacts-list">
        {shown.map((item) => (
          <ArtifactRow key={item.path} item={item} onOpen={openConversationFile} />
        ))}
      </ul>
      {extra.length > 0 ? (
        <button
          type="button"
          className="transcript-artifacts-more"
          data-testid="transcript-artifacts-more"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? t('artifacts.less') : t('artifacts.more', { n: extra.length })}
        </button>
      ) : null}
    </section>
  )
}
