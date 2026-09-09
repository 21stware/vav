import { tt } from '../i18n/useT'
import { useSessionStore } from '../state/sessionStore'

async function ensureActiveConversation(): Promise<string | null> {
  const store = useSessionStore.getState()
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
export async function attachScreenshot(opts?: { hideWindow?: boolean }): Promise<void> {
  document.documentElement.classList.add('is-screenshotting')
  try {
    const id = await ensureActiveConversation()
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

export async function attachPickedFiles(): Promise<void> {
  const id = await ensureActiveConversation()
  if (!id) return
  const result = await window.vav.files.pickAttachments()
  if (!result.ok || result.paths.length === 0) return
  useSessionStore.getState().addAttachments(id, result.paths)
}
