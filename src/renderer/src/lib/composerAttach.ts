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

/** Drag-select the screen (app stays visible), annotate, then pin the PNG. */
export async function attachScreenshot(): Promise<void> {
  document.documentElement.classList.add('is-screenshotting')
  try {
    const id = await ensureActiveConversation()
    if (!id) return
    const result = await window.vav.files.captureScreenshot()
    if (result.ok) {
      useSessionStore.getState().addAttachments(id, [result.path])
      return
    }
    if (result.cancelled) return
    useSessionStore.getState().showToast({
      kind: 'info',
      title:
        result.error === 'denied' ? tt('composer.screenshotDenied') : tt('composer.screenshotFailed')
    })
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
