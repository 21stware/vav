import { useEffect } from 'react'
import type { MenuCommand } from '@shared/ipc'
import { tt } from '../i18n/useT'
import { useSessionStore } from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { closeCurrentWindow, handleContextClose, installUiFocusTracking } from './uiFocus'

/** Ensure the session list is visible when switching archive / file-session modes. */
function ensureSidebarVisible(): void {
  const store = useSessionStore.getState()
  if (!store.sidebarVisible) store.toggleSidebar()
}

/**
 * Dispatch a native-menu / before-input MenuCommand against the local store.
 * Shared by main App and detached SessionWindow so accelerators work in both.
 */
export function handleMenuCommand(command: MenuCommand): void {
  const store = useSessionStore.getState()
  switch (command) {
    case 'new-conversation':
      void store.createConversation()
      break
    case 'focus-composer':
      store.focusComposer()
      break
    case 'find': {
      // Transcript find only — CLI / bash hosts have no searchable chat stream.
      const conv = store.conversations.find((c) => c.id === store.activeId)
      const agent = conv?.agentBinaryName
      if (agent && agent !== 'vav') break
      store.openSearch()
      break
    }
    case 'find-next':
      store.stepSearch(1)
      break
    case 'find-previous':
      store.stepSearch(-1)
      break
    case 'open-settings':
      store.openSettings()
      break
    case 'toggle-sidebar':
      store.toggleSidebar()
      break
    case 'toggle-tools-panel':
      store.toggleToolsPanel()
      break
    case 'toggle-panel-segment':
      store.togglePanelSegment()
      break
    case 'new-terminal':
      store.setPanelSegment('terminal')
      void useWorkspaceStore.getState().newBash(store.activeId, 80, 24)
      break
    case 'focus-bash':
      store.focusBashTerminal()
      break
    case 'switch-workdir':
      store.openWorkspaceSwitcher()
      break
    case 'send': {
      // ⌘↵ is composer-only. Never fire while Find / sidebar filter / other
      // inputs own the keyboard (plain Enter in search was already local;
      // this guards against accidental primary+Enter routing).
      const el = document.activeElement as HTMLElement | null
      if (el) {
        const tag = el.tagName
        const inComposer = !!el.closest('.composer')
        if (
          !inComposer &&
          (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable)
        ) {
          break
        }
      }
      const draft = store.drafts[store.activeId] ?? ''
      const attachments = store.attachments[store.activeId] ?? []
      void store.send(draft.trim(), attachments)
      break
    }
    case 'cancel-turn': {
      const id = store.activeId
      if (!id) break
      if (!store.turns[id]?.isRunning) break
      void store.cancel(id)
      break
    }
    case 'import-pack': {
      void (async () => {
        const result = await window.vav.conversations.importPack()
        if (result.ok === false) {
          if (result.cancelled) return
          useSessionStore.getState().showToast({
            kind: 'error',
            title: tt('sidebar.importFailed'),
            description: result.error
          })
          return
        }
        useSessionStore.getState().showToast({
          kind: 'success',
          title: tt('sidebar.importOk'),
          description: tt('sidebar.importOkDesc', {
            count: result.importedIds.length,
            blobs: result.blobCount
          })
        })
        if (result.importedIds[0]) {
          void useSessionStore.getState().selectConversation(result.importedIds[0])
        }
      })()
      break
    }
    case 'export-pack': {
      const id = store.activeId
      if (!id) break
      // Don't export file-bound sessions as a full pack from the menu.
      const meta = store.conversations.find((c) => c.id === id)
      if (meta?.fileId) {
        store.showToast({
          kind: 'info',
          title: tt('menu.exportPackUnavailable')
        })
        break
      }
      void (async () => {
        const result = await window.vav.conversations.exportPack([id])
        if (result.ok === false) {
          if (result.cancelled) return
          useSessionStore.getState().showToast({
            kind: 'error',
            title: tt('sidebar.exportFailed'),
            description: result.error
          })
          return
        }
        useSessionStore.getState().showToast({
          kind: 'success',
          title: tt('sidebar.exportOk'),
          description: tt('sidebar.exportOkDesc', {
            path: result.path,
            count: result.conversationCount,
            blobs: result.blobCount
          })
        })
      })()
      break
    }
    case 'open-shortcuts':
      store.setShortcutsOpen(true)
      break
    case 'show-sessions':
      ensureSidebarVisible()
      store.setSidebarListMode('main')
      break
    case 'show-archive':
      ensureSidebarVisible()
      store.setSidebarListMode('archive')
      break
    case 'show-file-sessions':
      ensureSidebarVisible()
      store.setSidebarListMode('fileSessions')
      break
    case 'check-updates':
      void store.checkForUpdates()
      break
    case 'close-context':
      // Bash → close tab; Files → collapse tray; multi-pane agent → close pane;
      // otherwise close/hide this window.
      if (!handleContextClose()) closeCurrentWindow()
      break
    case 'focus-tools-1':
    case 'focus-tools-2':
    case 'focus-tools-3':
    case 'focus-tools-4':
    case 'focus-tools-5':
    case 'focus-tools-6':
    case 'focus-tools-7':
    case 'focus-tools-8':
    case 'focus-tools-9':
      store.focusToolsSlot(Number(command.slice('focus-tools-'.length)))
      break
    default:
      break
  }
}

/** Subscribe to main-process menu / before-input commands for this window. */
export function useMenuCommands(): void {
  useEffect(() => {
    const offFocus = installUiFocusTracking()
    const offMenu = window.vav.onMenuCommand((command) => {
      handleMenuCommand(command)
    })
    return () => {
      offFocus()
      offMenu()
    }
  }, [])
}
