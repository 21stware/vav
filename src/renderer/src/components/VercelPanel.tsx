import { useCallback, useEffect, useState } from 'react'
import type { ConnectorDetect } from '@shared/connector'
import { useWorkspaceStore } from '../state/workspaceStore'
import { useSessionStore } from '../state/sessionStore'
import { useT } from '../i18n/useT'
import { EmptyState } from './ui'

export type VercelPanelChrome = {
  meta: string | null
  loading: boolean
  refresh: () => void
}

export function VercelPanel({
  visible,
  onChrome
}: {
  visible: boolean
  onChrome?: (chrome: VercelPanelChrome | null) => void
}): React.JSX.Element {
  const t = useT()
  const activeId = useSessionStore((s) => s.activeId)
  const root = useWorkspaceStore((s) => s.workspaces[activeId]?.root ?? null)
  const [row, setRow] = useState<ConnectorDetect | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!root || !window.vav?.connectors?.detect) {
      setRow(null)
      return
    }
    setLoading(true)
    try {
      const rows = await window.vav.connectors.detect(root)
      setRow(rows.find((item) => item.id === 'vercel') ?? null)
    } catch {
      setRow(null)
    } finally {
      setLoading(false)
    }
  }, [root])

  useEffect(() => {
    if (!visible) return
    void refresh()
  }, [visible, refresh])

  useEffect(() => {
    onChrome?.({
      meta: row?.present ? row.label || t('vercel.detected') : null,
      loading,
      refresh: () => {
        void refresh()
      }
    })
    return () => onChrome?.(null)
  }, [loading, onChrome, refresh, row, t])

  if (!row?.present) {
    return (
      <EmptyState title={t('vercel.emptyTitle')} description={t('vercel.emptyDesc')} />
    )
  }

  return (
    <div className="git-panel" data-testid="vercel-panel">
      <EmptyState
        title={row.label || t('vercel.detected')}
        description={
          row.configPath
            ? `${row.configPath}\n${t('vercel.readonlyHint')}`
            : t('vercel.readonlyHint')
        }
      />
    </div>
  )
}
