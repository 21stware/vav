import { useEffect, useState } from 'react'
import { useAppearance } from './lib/appearance'
import { installDefaultContextMenu } from './lib/nativeMenu'
import { installSettingsBridge, useSessionStore } from './state/sessionStore'
import { useT } from './i18n/useT'
import { TokenUsagePanel } from './components/TokenUsagePanel'

/**
 * Native panel popup for context-window / token usage details.
 * Shell chrome lives in the main process (frameless BrowserWindow); this is
 * just the content surface.
 */
export default function TokenUsageWindow({
  conversationId: initialId
}: {
  conversationId: string
}): React.JSX.Element {
  const t = useT()
  const ready = useSessionStore((s) => s.ready)
  const bootstrap = useSessionStore((s) => s.bootstrap)
  const [conversationId, setConversationId] = useState(initialId)

  useEffect(() => {
    document.title = t('token.contextWindow')
    void bootstrap()
  }, [bootstrap, t])

  useEffect(() => {
    const offSettings = installSettingsBridge()
    const offMenu = installDefaultContextMenu()
    const offView = window.vav.window.onTokenUsageView((id) => setConversationId(id))
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') window.close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      offSettings()
      offMenu()
      offView()
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  useAppearance()

  if (!ready) {
    return (
      <div className="token-usage-popup">
        <div className="token-usage-popup-title">{t('token.contextWindow')}</div>
        <div className="token-usage-popup-body muted">{t('common.loading')}</div>
      </div>
    )
  }

  return (
    <div className="token-usage-popup">
      <div className="token-usage-popup-title">{t('token.contextWindow')}</div>
      <div className="token-usage-popup-body">
        <TokenUsagePanel conversationId={conversationId} />
      </div>
    </div>
  )
}
