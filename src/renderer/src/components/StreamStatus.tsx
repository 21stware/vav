/**
 * Conversation-level stream mark: flip-book + shimmer while live;
 * one settled Done after the last sealed assistant turn.
 *
 * Light/dark spirit strips ship as separate assets (no CSS invert) so the
 * dark sheet can keep its own gray ink.
 */
import { displayNameForCliHost, isStructuredCliHost } from '@shared/cliHost'
import { agentModelHostKey, labelForChatModel } from '@shared/agentModels'
import { vendorDisplayName } from '@shared/llmVendors'
import { enabledCliAgents } from '@shared/types'
import doneMark from '../assets/loading/done.png'
import doneMarkDark from '../assets/loading/dark-done.png'
import loadingSprite from '../assets/loading/sprite.png'
import loadingSpriteDark from '../assets/loading/dark-sprite.png'
import { useAccountGroups, vavAccountsOf } from '../lib/accountGroups'
import { useSessionStore } from '../state/sessionStore'
import { useT } from '../i18n/useT'

export function StreamStatus({
  state,
  conversationId
}: {
  state: 'outputting' | 'done'
  conversationId?: string
}): React.JSX.Element {
  const t = useT()
  const detail = useOutputtingDetail(state === 'outputting' ? conversationId : undefined)
  const label = detail ? `${t('stream.outputting')} · ${detail}` : t('stream.outputting')

  if (state === 'done') {
    return (
      <div className="stream-status" data-testid="stream-status" data-state="done">
        <span className="stream-status-mark" data-static aria-hidden>
          <img className="logo-light" src={doneMark} alt="" draggable={false} />
          <img className="logo-dark" src={doneMarkDark} alt="" draggable={false} />
        </span>
        {t('stream.done')}
      </div>
    )
  }

  return (
    <div className="stream-status" data-testid="stream-status" data-state="outputting">
      <span className="stream-status-mark" aria-hidden>
        <img
          className="stream-status-mark-sprite logo-light"
          src={loadingSprite}
          alt=""
          draggable={false}
        />
        <img
          className="stream-status-mark-sprite logo-dark"
          src={loadingSpriteDark}
          alt=""
          draggable={false}
        />
      </span>
      <span className="stream-status-shimmer">{label}</span>
    </div>
  )
}

function useOutputtingDetail(conversationId: string | undefined): string | null {
  const conversation = useSessionStore((s) =>
    conversationId ? s.conversations.find((c) => c.id === conversationId) : undefined
  )
  const settings = useSessionStore((s) => s.settings)
  const catalog = useSessionStore((s) => s.agentModelCatalog)
  const accountGroups = useAccountGroups()
  const t = useT()

  if (!conversation) return null
  const host = conversation.cliHost ?? null
  const catalogue = catalog[agentModelHostKey(host)]?.models ?? null
  const modelLabel = labelForChatModel(
    host,
    conversation.model,
    settings.customModels,
    catalogue
  )
  let agentName: string
  if (host && isStructuredCliHost(host)) {
    const named = enabledCliAgents(settings.cliAgents).find((agent) => agent.id === host)
    agentName = named?.name ?? displayNameForCliHost(host)
  } else {
    const rows = vavAccountsOf(accountGroups)
    const current =
      rows.find((row) => row.id === conversation.accountId) ??
      rows.find((row) => row.current) ??
      rows[0]
    const endpoint = current?.endpoint ?? settings.apiEndpoint
    agentName = vendorDisplayName(endpoint, t('agents.customModel'))
  }
  const parts = [agentName, modelLabel].filter((part) => part && part !== 'Default')
  if (parts.length === 0) return agentName || modelLabel || null
  return parts.join(' ')
}
