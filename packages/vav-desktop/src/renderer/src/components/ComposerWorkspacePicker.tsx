import { useCallback, useEffect, useRef } from 'react'
import { ChevronDown, Folder } from 'lucide-react'
import { formatWorkspaceLabel, normalizeMachineId } from '@shared/workspaceHost'
import { useSessionStore } from '../state/sessionStore'
import { useT } from '../i18n/useT'
import { isTemporaryWorkspace, workdirShortLabel } from '../lib/format'
import { createMenuNonceGate } from '../lib/menuNonce'
import { PENDING_COMPOSER_ID } from '../lib/pendingComposer'
import {
  openWorkspaceSwitchMenu,
  workspaceSwitchMenuItems
} from '../lib/workspaceSwitchMenu'

const consumeWorkspaceMenuNonce = createMenuNonceGate()

export function ComposerWorkspacePicker(): React.JSX.Element {
  const t = useT()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const pending = useSessionStore((s) => s.pendingHomeWorkspace)
  const tmp = useSessionStore((s) => s.tmp)
  const hosts = useSessionStore((s) => s.hosts)
  const recentDirs = useSessionStore((s) => s.settings.recentWorkspaceDirectories)
  const defaultWorkdir = useSessionStore((s) => s.settings.defaultWorkingDirectory)
  const windowMachineId = useSessionStore((s) => s.windowMachineId)
  const agentVisible = useSessionStore((s) => s.agentVisible)
  const workspaceMenuNonce = useSessionStore((s) => s.workspaceMenuNonce)
  const pickWorkingDirectory = useSessionStore((s) => s.pickWorkingDirectory)
  const useTempWorkingDirectory = useSessionStore((s) => s.useTempWorkingDirectory)
  const setWorkingDirectory = useSessionStore((s) => s.setWorkingDirectory)
  const openRemoteFolderPicker = useSessionStore((s) => s.openRemoteFolderPicker)

  const machineId = normalizeMachineId(pending?.machineId ?? windowMachineId)
  const cwd = pending ? pending.path : defaultWorkdir.trim() || null
  const temporary = isTemporaryWorkspace(cwd, tmp)
  const label = formatWorkspaceLabel(
    pending?.machineId ?? windowMachineId,
    temporary ? t('sidebar.defaultWorkspace') : workdirShortLabel(cwd ?? '', tmp),
    hosts.find((h) => h.id === (pending?.machineId ?? windowMachineId))?.name
  )

  const items = useCallback(
    () =>
      workspaceSwitchMenuItems({
        t,
        recentDirs,
        conversationId: PENDING_COMPOSER_ID,
        machineId,
        hosts,
        setWorkingDirectory,
        useTempWorkingDirectory,
        pickWorkingDirectory,
        openRemoteFolderPicker
      }),
    [
      hosts,
      machineId,
      openRemoteFolderPicker,
      pickWorkingDirectory,
      recentDirs,
      setWorkingDirectory,
      t,
      useTempWorkingDirectory
    ]
  )

  const openMenu = useCallback(
    (anchor?: HTMLElement | null) => {
      openWorkspaceSwitchMenu(items(), anchor)
    },
    [items]
  )

  useEffect(() => {
    if (agentVisible) return
    if (!consumeWorkspaceMenuNonce(workspaceMenuNonce)) return
    openMenu(buttonRef.current)
  }, [agentVisible, openMenu, workspaceMenuNonce])

  return (
    <button
      ref={buttonRef}
      type="button"
      className="model-picker session-run-btn composer-workspace-btn"
      data-testid="composer-workspace"
      aria-haspopup="menu"
      title={cwd ?? t('empty.switchWorkspace')}
      aria-label={t('empty.switchWorkspace')}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        openMenu(event.currentTarget)
      }}
    >
      <Folder size={12} strokeWidth={2} aria-hidden />
      <span className="session-run-level">{label}</span>
      <ChevronDown size={9} className="session-run-caret" aria-hidden />
    </button>
  )
}
