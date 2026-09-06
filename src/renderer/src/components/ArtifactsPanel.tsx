import { useMemo } from 'react'
import { ArtifactList } from './TranscriptArtifacts'
import { EmptyState } from './ui'
import { openConversationFile } from '../lib/openSessionFile'
import { useConversationArtifacts } from '../lib/useConversationArtifacts'
import { useSessionStore, visibleMessages } from '../state/sessionStore'
import { useT } from '../i18n/useT'

/** Files tray → Artifacts: session catalog of files the agent produced. */
export function ArtifactsPanel({
  visible: _visible,
  active: _active
}: {
  visible: boolean
  active: boolean
}): React.JSX.Element {
  const t = useT()
  const activeId = useSessionStore((s) => s.activeId)
  const nodes = useSessionStore((s) => (activeId ? s.messages[activeId] : undefined))
  const leaf = useSessionStore((s) => (activeId ? (s.activeLeaf[activeId] ?? null) : null))
  const messages = useMemo(
    () => (activeId ? visibleMessages(useSessionStore.getState(), activeId) : []),
    [activeId, nodes, leaf]
  )
  const artifacts = useConversationArtifacts(activeId, messages)

  return (
    <div
      className="artifacts-panel"
      data-testid="artifacts-panel"
      data-empty={artifacts.length === 0 || undefined}
    >
      {artifacts.length === 0 ? (
        <EmptyState title={t('artifacts.emptyTitle')} description={t('artifacts.emptyDesc')} />
      ) : (
        <ArtifactList
          artifacts={artifacts}
          onOpen={openConversationFile}
          testId="artifacts-panel-row"
        />
      )}
    </div>
  )
}
