import {
  isLocalMachine,
  normalizeMachineId,
  recentsForMachine,
  type WorkspaceHostInfo,
  type WorkspaceRef
} from '@shared/workspaceHost'
import type { MessageKey, TParams } from '@shared/i18n'
import { basename } from './path'
import { menuAnchor, showMenu, type MenuItem } from './nativeMenu'

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
