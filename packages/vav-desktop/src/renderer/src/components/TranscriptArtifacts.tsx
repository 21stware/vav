import { useMemo, useState, type ReactNode } from 'react'
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
  partitionConversationArtifacts,
  type ConversationArtifact,
  type ConversationArtifactTone
} from '@shared/conversationArtifacts'
import type { ChatMessage } from '@shared/types'
import { formatBadge } from '../lib/previewBlocks'
import { showMenu } from '../lib/nativeMenu'
import { fileManagerLabel } from '../lib/platform'
import { openConversationFile, revealSessionFileInFinder } from '../lib/openSessionFile'
import { useConversationArtifacts } from '../lib/useConversationArtifacts'
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

function ArtifactIcon({ tone }: { tone: ConversationArtifactTone }): ReactNode {
  const Icon = TONE_ICON[tone]
  return <Icon size={14} strokeWidth={1.75} aria-hidden />
}

export function ArtifactRow({
  item,
  onOpen,
  testId = 'transcript-artifact'
}: {
  item: ConversationArtifact
  onOpen: (path: string) => void
  testId?: string
}): React.JSX.Element {
  const t = useT()
  const badge = formatBadge(item.path, item.previewKind)
  return (
    <li>
      <button
        type="button"
        className="transcript-artifact"
        data-testid={testId}
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

export function ArtifactList({
  artifacts,
  onOpen,
  testId = 'transcript-artifact'
}: {
  artifacts: ConversationArtifact[]
  onOpen: (path: string) => void
  testId?: string
}): React.JSX.Element {
  return (
    <ul className="transcript-artifacts-list">
      {artifacts.map((item) => (
        <ArtifactRow key={item.path} item={item} onOpen={onOpen} testId={testId} />
      ))}
    </ul>
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
  const artifacts = useConversationArtifacts(conversationId, messages)
  const [expanded, setExpanded] = useState(false)
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
      <ArtifactList artifacts={shown} onOpen={openConversationFile} />
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
