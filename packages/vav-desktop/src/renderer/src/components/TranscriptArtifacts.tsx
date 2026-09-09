import type { ReactNode } from 'react'
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
import type { ConversationArtifact, ConversationArtifactTone } from '@shared/conversationArtifacts'
import { formatBadge } from '../lib/previewBlocks'
import { showMenu } from '../lib/nativeMenu'
import { fileManagerLabel } from '../lib/platform'
import { revealSessionFileInFinder } from '../lib/openSessionFile'
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
