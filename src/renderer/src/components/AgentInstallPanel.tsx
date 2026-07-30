import { useState } from 'react'
import { Download, ExternalLink, RefreshCw, X } from 'lucide-react'
import type { AgentConfig } from '@shared/types'
import { useT } from '../i18n/useT'
import { Button } from './ui'
import { AgentBrandMark } from './AgentBrandMark'
import { InlineTerminal } from './InlineTerminal'

/**
 * Gate when the selected CLI agent binary is not on PATH.
 * Install expands an inline interactive terminal; PATH is polled automatically
 * so the user does not need a manual “done — recheck” confirm.
 */
export function AgentInstallPanel({
  agent,
  conversationId,
  rechecking = false,
  installing = false,
  installTabId = null,
  onRecheck,
  onInstallInShell,
  onCancelInstall,
  onOpenDocs
}: {
  agent: AgentConfig
  conversationId: string
  rechecking?: boolean
  installing?: boolean
  installTabId?: string | null
  onRecheck: () => void
  onInstallInShell: () => void
  onCancelInstall: () => void
  onOpenDocs: () => void
}): React.JSX.Element {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const cmd = agent.installCommand?.trim() || ''
  const binary = agent.binaryPath || agent.id

  const copyCmd = async (): Promise<void> => {
    if (!cmd) return
    try {
      await navigator.clipboard.writeText(cmd)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  return (
    <div className="agent-install-panel">
      <div className={`agent-install-card${installing ? ' is-installing' : ''}`}>
        {installing ? (
          <button
            type="button"
            className="agent-install-cancel-corner"
            title={t('agents.installCancel')}
            aria-label={t('agents.installCancel')}
            onClick={onCancelInstall}
          >
            <X size={14} strokeWidth={2.25} />
          </button>
        ) : null}

        <AgentBrandMark agent={agent} size={48} />
        <h2 className="agent-install-title">{t('agents.installTitle', { name: agent.name })}</h2>
        <p className="agent-install-desc">
          {installing
            ? t('agents.installInlineHint', { name: agent.name })
            : t('agents.installDesc', { name: agent.name, binary })}
        </p>

        {!installing && cmd ? (
          <pre
            className="agent-install-cmd"
            onClick={() => void copyCmd()}
            title={t('agents.installCopy')}
          >
            {cmd}
          </pre>
        ) : null}
        {!installing && !cmd ? (
          <p className="agent-install-desc muted">{t('agents.installNoCommand')}</p>
        ) : null}

        {installing && installTabId ? (
          <div className="agent-install-inline-term">
            <div className="agent-install-inline-term-bar">
              <span className="muted tiny">{t('agents.installShellTitle', { name: agent.name })}</span>
              <span className="spacer" />
              <span className="agent-install-auto-hint muted tiny">
                {rechecking ? t('agents.installRechecking') : t('agents.installAutoDetect')}
              </span>
            </div>
            <div className="agent-install-inline-term-body">
              <InlineTerminal
                conversationId={conversationId}
                tabId={installTabId}
                active={installing}
              />
            </div>
          </div>
        ) : null}

        <div className="agent-install-actions">
          {!installing && cmd ? (
            <Button
              label={t('agents.installRun')}
              icon={<Download size={14} />}
              variant="primary"
              onClick={onInstallInShell}
            />
          ) : null}
          {!installing ? (
            <Button
              label={rechecking ? t('agents.installRechecking') : t('agents.installRecheck')}
              icon={<RefreshCw size={14} />}
              variant="secondary"
              disabled={rechecking}
              onClick={onRecheck}
            />
          ) : null}
          {!installing && agent.installDocsUrl ? (
            <Button
              label={t('agents.installDocs')}
              icon={<ExternalLink size={14} />}
              variant="ghost"
              onClick={onOpenDocs}
            />
          ) : null}
        </div>
        {copied ? <p className="agent-install-copied">{t('agents.installCopied')}</p> : null}
        {!installing ? (
          <p className="agent-install-hint muted">{t('agents.installHint')}</p>
        ) : null}
      </div>
    </div>
  )
}
