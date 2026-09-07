import { type ReactNode } from 'react'
import { useSessionStore } from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { requestCliSurface } from '../lib/cliSurfaceSwitch'
import { useT } from '../i18n/useT'
import { StaggerLine, useEmptyEntranceCopy } from './ui'

function TextBtn({
  children,
  disabled,
  title,
  onClick
}: {
  children: ReactNode
  disabled?: boolean
  title?: string
  onClick: (el: HTMLElement) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="session-workspace-text-btn"
      disabled={disabled}
      title={title}
      onClick={(e) => onClick(e.currentTarget)}
    >
      {children}
    </button>
  )
}

/** Folder is not a repo — Git tray only (not the empty session). */
export function EnableVersionControlChrome({
  projectName,
  temporary,
  busy,
  error,
  onInit,
  motionKey,
  entering
}: {
  projectName: string
  temporary: boolean
  busy: boolean
  error: string | null
  onInit: () => void
  /** Session empty-state only — omit in the Git tray so tab switches stay still. */
  motionKey?: string
  /** The hero's entrance is running: these lines are part of that one build-up. */
  entering?: boolean
}): React.JSX.Element {
  const t = useT()
  const nameLine = (
    <>
      <span className="session-workspace-prose-strong">{projectName}</span>{' '}
      <span className="session-workspace-prose-muted">
        {temporary ? t('git.prose.tempNotRepo') : t('git.prose.notRepo')}
      </span>
    </>
  )
  const enableLine = (
    <>
      <span className="session-workspace-prose-muted">{t('git.prose.enableLead')}</span>{' '}
      <TextBtn disabled={busy} onClick={() => onInit()}>
        {busy ? t('common.loading') : t('git.prose.enableAction')}
      </TextBtn>{' '}
      <span className="session-workspace-prose-muted">{t('git.prose.enableTail')}</span>
    </>
  )
  return (
    <div className={`session-workspace-chrome${entering ? ' is-entering' : ''}`}>
      <p className="session-workspace-prose">
        {motionKey ? (
          <StaggerLine baseDelay={120} key={`${motionKey}:norepo`}>
            {nameLine}
          </StaggerLine>
        ) : (
          nameLine
        )}
      </p>
      <p className="session-workspace-prose">
        {motionKey ? (
          <StaggerLine baseDelay={280} key={`${motionKey}:enable`}>
            {enableLine}
          </StaggerLine>
        ) : (
          enableLine
        )}
      </p>
      {error && <div className="session-workspace-error">{error}</div>}
    </div>
  )
}

/**
 * Empty-session chrome: current workspace, with a switcher.
 * Git init / branch / worktree live in Files → Git, not here.
 */
export function SessionWorkspaceChrome({
  conversationId
}: {
  conversationId?: string
} = {}): React.JSX.Element | null {
  const t = useT()
  const storeActiveId = useSessionStore((s) => s.activeId)
  const activeId = conversationId || storeActiveId
  const swarmEnabled = useSessionStore((s) => s.settings.swarmModeEnabled === true)
  const cliMode = useWorkspaceStore((s) => !!s.workspaces[activeId]?.cliMode)
  const copy = useEmptyEntranceCopy(true)
  const motionKey = copy.motionKey ?? activeId ?? 'ws'

  if (!activeId) return null

  const showCli = swarmEnabled && !cliMode

  return (
    <div className={`session-workspace-chrome${copy.entering ? ' is-entering' : ''}`}>
      {showCli ? (
        <p className="session-workspace-prose">
          <StaggerLine baseDelay={280} key={`${motionKey}:cli`}>
            <TextBtn
              title={t('empty.useCliHint')}
              onClick={() => requestCliSurface(activeId, true)}
            >
              {t('empty.useCliAction')}
            </TextBtn>
          </StaggerLine>
        </p>
      ) : null}
    </div>
  )
}
