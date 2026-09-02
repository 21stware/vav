import {
  formatWorkspaceLabel,
  isLocalMachine,
  normalizeMachineId,
  recentsForMachine,
  type WorkspaceHostInfo,
  type WorkspaceRef
} from '@shared/workspaceHost'
import type { MessageKey, TParams } from '@shared/i18n'
import { useCallback } from 'react'
import { useSessionStore } from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { useT } from '../i18n/useT'
import { isTemporaryWorkspace, workdirShortLabel } from './format'
import { basename } from './path'
import { menuAnchor, showMenu, type MenuItem } from './nativeMenu'
import { allowWorkdirSwitch, isSwarmSurfaceActive } from './workdirSwitch'

type TFn = (key: MessageKey, params?: TParams) => string

/** Same native menu as the tools-tray change-workspace control. */
export function workspaceSwitchMenuItems(input: {
  t: TFn
  recentDirs: WorkspaceRef[]
  conversationId: string
  machineId: string
  hosts: WorkspaceHostInfo[]
  setWorkingDirectory: (id: string, path: string, machineId?: string | null) => void
  useTempWorkingDirectory: (id: string) => void
  pickWorkingDirectory: (id: string) => void
  openRemoteFolderPicker: (id: string, machineId: string) => void
}): MenuItem[] {
  const {
    t,
    recentDirs,
    conversationId,
    machineId,
    hosts,
    setWorkingDirectory,
    useTempWorkingDirectory,
    pickWorkingDirectory,
    openRemoteFolderPicker
  } = input
  const id = normalizeMachineId(machineId)
  const recents = recentsForMachine(recentDirs, id)
  const host = hosts.find((h) => h.id === id)
  const remote = !isLocalMachine(id)
  const items: MenuItem[] = []
  if (recents.length === 0) {
    items.push({ label: t('tools.noRecentDirs'), disabled: true })
  } else {
    items.push({ label: t('tools.recentDirs'), disabled: true })
    for (const ref of recents) {
      const name = basename(ref.path)
      const duplicate = recents.filter((entry) => basename(entry.path) === name).length > 1
      items.push({
        label: duplicate ? ref.path : name,
        onSelect: () => void setWorkingDirectory(conversationId, ref.path, ref.machineId)
      })
    }
  }
  items.push({ label: '', divider: true })
  items.push({
    label: t('tools.newTempDir'),
    onSelect: () => void useTempWorkingDirectory(conversationId)
  })
  items.push({
    label: t('tools.pickOtherDir'),
    disabled: remote && host?.online === false,
    onSelect: () => {
      if (remote) openRemoteFolderPicker(conversationId, id)
      else void pickWorkingDirectory(conversationId)
    }
  })
  return items
}

export function openWorkspaceSwitchMenu(items: MenuItem[], anchor?: HTMLElement | null): void {
  void showMenu(items, anchor ? menuAnchor(anchor) : undefined)
}

/** Empty-session title: project name + the change-workspace menu. */
export function useWorkspaceSwitchMenu(conversationId?: string): {
  projectName: string
  cwd: string | null
  allowSwitch: boolean
  openMenu: (anchor?: HTMLElement | null) => void
} {
  const t = useT()
  const conversation = useSessionStore((s) =>
    conversationId ? s.conversations.find((c) => c.id === conversationId) : undefined
  )
  const tmp = useSessionStore((s) => s.tmp)
  const hosts = useSessionStore((s) => s.hosts)
  const recentDirs = useSessionStore((s) => s.settings.recentWorkspaceDirectories)
  const windowMachineId = useSessionStore((s) => s.windowMachineId)
  const swarmEnabled = useSessionStore((s) => s.settings.swarmModeEnabled === true)
  const cliMode = useWorkspaceStore((s) =>
    conversationId ? !!s.workspaces[conversationId]?.cliMode : false
  )
  const pickWorkingDirectory = useSessionStore((s) => s.pickWorkingDirectory)
  const useTempWorkingDirectory = useSessionStore((s) => s.useTempWorkingDirectory)
  const setWorkingDirectory = useSessionStore((s) => s.setWorkingDirectory)
  const openRemoteFolderPicker = useSessionStore((s) => s.openRemoteFolderPicker)

  const cwd = conversation?.workingDirectory ?? null
  const temporary = isTemporaryWorkspace(cwd, tmp)
  const machineId = normalizeMachineId(conversation?.machineId ?? windowMachineId)
  const projectName = formatWorkspaceLabel(
    conversation?.machineId,
    temporary ? t('sidebar.defaultWorkspace') : workdirShortLabel(cwd ?? '', tmp),
    hosts.find((h) => h.id === conversation?.machineId)?.name
  )
  const allowSwitch = allowWorkdirSwitch({
    swarmSurface: isSwarmSurfaceActive(swarmEnabled, cliMode),
    enclosedUnrevealed: false,
    rootMissing: false
  })

  const items = useCallback((): MenuItem[] => {
    if (!conversationId) return []
    return workspaceSwitchMenuItems({
      t,
      recentDirs,
      conversationId,
      machineId,
      hosts,
      setWorkingDirectory,
      useTempWorkingDirectory,
      pickWorkingDirectory,
      openRemoteFolderPicker
    })
  }, [
    conversationId,
    hosts,
    machineId,
    openRemoteFolderPicker,
    pickWorkingDirectory,
    recentDirs,
    setWorkingDirectory,
    t,
    useTempWorkingDirectory
  ])

  const openMenu = useCallback(
    (anchor?: HTMLElement | null) => {
      if (!allowSwitch) return
      openWorkspaceSwitchMenu(items(), anchor)
    },
    [allowSwitch, items]
  )

  return { projectName, cwd, allowSwitch, openMenu }
}
