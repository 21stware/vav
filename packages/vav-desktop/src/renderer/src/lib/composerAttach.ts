import { tt } from '../i18n/useT'
import { handoffFileFocusToCli } from './cliFocusHandoff'
import { isHomeComposerId, PENDING_COMPOSER_ID } from './pendingComposer'
import { useSessionStore } from '../state/sessionStore'

async function ensureComposerTarget(conversationId?: string | null): Promise<string | null> {
  const pinned = conversationId?.trim() || ''
  if (isHomeComposerId(pinned)) return PENDING_COMPOSER_ID
  const store = useSessionStore.getState()
  if (pinned && store.conversations.some((c) => c.id === pinned)) return pinned
  const current = store.activeId
  if (current && store.conversations.some((c) => c.id === current)) return current
  const created = await store.createConversation({ openIn: 'here' })
  if (typeof created === 'string' && created) return created
  return useSessionStore.getState().activeId || null
}

/**
 * Drag-select the screen, annotate, then pin the PNG.
 * `hideWindow` overrides the default (`screenshotKeepWindowFront`).
 */
export async function attachScreenshot(opts?: {
  hideWindow?: boolean
  conversationId?: string | null
}): Promise<void> {
  document.documentElement.classList.add('is-screenshotting')
  try {
    const id = await ensureComposerTarget(opts?.conversationId)
    if (!id) return
    const hideWindow =
      opts?.hideWindow ??
      useSessionStore.getState().settings.screenshotKeepWindowFront === false
    const result = await window.vav.files.captureScreenshot(
      hideWindow ? { hideWindows: true } : undefined
    )
    if (result.ok) {
      useSessionStore.getState().addAttachments(id, [result.path])
      return
    }
    if (result.cancelled) return
    const store = useSessionStore.getState()
    if (result.error === 'denied') {
      // Missing Screen Recording permission — authorization only happens in the
      // macOS System Settings pane, so confirm opens it directly.
      store.showDialog({
        title: tt('composer.screenshotDeniedTitle'),
        body: tt('composer.screenshotDeniedBody'),
        confirmLabel: tt('composer.screenshotOpenSystemSettings'),
        onConfirm: () => void window.vav.files.openScreenshotPermissionSettings()
      })
      return
    }
    store.showToast({ kind: 'info', title: tt('composer.screenshotFailed') })
  } finally {
    document.documentElement.classList.remove('is-screenshotting')
  }
}

export async function attachPickedFiles(conversationId?: string | null): Promise<void> {
  const id = await ensureComposerTarget(conversationId)
  if (!id) return
  const result = await window.vav.files.pickAttachments()
  if (!result.ok || result.paths.length === 0) return
  useSessionStore.getState().addAttachments(id, result.paths)
}

/** Files panel / preview: pin paths on the composer like a paperclip or drop. */
export function addFilesToComposer(paths: string[], conversationId?: string | null): void {
  const store = useSessionStore.getState()
  const pinned = conversationId?.trim() || ''
  const id = isHomeComposerId(pinned)
    ? PENDING_COMPOSER_ID
    : pinned || store.activeId || PENDING_COMPOSER_ID
  if (!id) return
  const files = [...new Set(paths.map((path) => path.trim()).filter(Boolean))]
  if (files.length === 0) return
  store.addAttachments(id, files)
  store.focusComposer(id)
  if (files.length === 1) void handoffFileFocusToCli(id, files[0]!)
}
