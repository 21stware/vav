import { tt } from '../../i18n/useT'
import { EmptyState } from '../ui'

/** Files tray / folder picker: pane empty matches Artifacts; nested stays a row. */
export function FolderEmptyState({
  compact = false,
  padLeft
}: {
  compact?: boolean
  padLeft?: number
}): React.JSX.Element {
  if (compact) {
    return (
      <div
        className="files-empty-nested muted tiny"
        style={padLeft != null ? { paddingLeft: padLeft } : undefined}
      >
        {tt('files.emptyFolder')}
      </div>
    )
  }
  return (
    <EmptyState title={tt('files.emptyFolder')} description={tt('files.emptyFolderDesc')} />
  )
}
