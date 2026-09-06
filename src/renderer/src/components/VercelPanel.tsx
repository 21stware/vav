import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, CircleDashed, ExternalLink, LoaderCircle, Triangle, X } from 'lucide-react'
import type { VercelDeployStatus, VercelErrorCode, VercelStatus } from '@shared/vercel'
import { useSessionStore } from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { useT, tt } from '../i18n/useT'
import { relativeTime } from '../lib/format'
import { Button, EmptyState } from './ui'

export type VercelPanelChrome = {
  meta: string | null
  loading: boolean
  refresh: () => void
}

function statusLabel(status: VercelDeployStatus, t: ReturnType<typeof useT>): string {
  if (status === 'ready') return t('vercel.statusReady')
  if (status === 'error') return t('vercel.statusError')
  if (status === 'building') return t('vercel.statusBuilding')
  if (status === 'queued') return t('vercel.statusQueued')
  if (status === 'canceled') return t('vercel.statusCanceled')
  return t('vercel.statusUnknown')
}

function statusClass(status: VercelDeployStatus): string {
  if (status === 'ready') return 'is-merged'
  if (status === 'error') return 'is-closed'
  if (status === 'building' || status === 'queued') return 'is-open'
  return 'is-draft'
}

function StatusIcon({
  status,
  size = 12
}: {
  status: VercelDeployStatus
  size?: number
}): React.JSX.Element {
  if (status === 'ready') return <Check size={size} />
  if (status === 'error') return <X size={size} />
  if (status === 'building' || status === 'queued') {
    return <LoaderCircle size={size} className="github-action-spin" />
  }
  return <CircleDashed size={size} />
}

function emptyForCode(
  code: VercelErrorCode | undefined,
  fallback: string,
  t: ReturnType<typeof useT>
): { title: string; description: string } {
  if (code === 'auth') {
    return { title: t('vercel.authFailed'), description: t('vercel.authFailedDesc') }
  }
  if (code === 'not-found') {
    return { title: t('vercel.notFound'), description: t('vercel.notFoundDesc') }
  }
  if (code === 'no-config') {
    return { title: t('vercel.emptyTitle'), description: t('vercel.emptyDesc') }
  }
  if (code === 'network') {
    return { title: t('vercel.loadFailed'), description: t('vercel.networkDesc') }
  }
  return { title: t('vercel.loadFailed'), description: fallback }
}

function openUrl(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

/** Files tray → Vercel: this workspace’s project and latest deployments. */
export function VercelPanel({
  visible,
  onChrome
}: {
  visible: boolean
  onChrome?: (chrome: VercelPanelChrome | null) => void
}): React.JSX.Element {
  const t = useT()
  const activeId = useSessionStore((s) => s.activeId)
  const openSettings = useSessionStore((s) => s.openSettings)
  const tokenPresent = useSessionStore((s) => s.settings.vercelApiTokenPresent === true)
  const root = useWorkspaceStore((s) => s.workspaces[activeId]?.root ?? null)

  const [status, setStatus] = useState<VercelStatus | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadCode, setLoadCode] = useState<VercelErrorCode | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [deploying, setDeploying] = useState(false)
  const [deployError, setDeployError] = useState<string | null>(null)
  const [deploySummary, setDeploySummary] = useState<string | null>(null)

  const applyStatus = (next: VercelStatus): void => {
    setStatus(next)
    setLoadError(null)
    setLoadCode(undefined)
  }

  const refresh = useCallback(async (): Promise<void> => {
    if (!root) {
      setStatus(null)
      setLoadError(null)
      setLoadCode(undefined)
      return
    }
    if (!window.vav?.vercel?.status) {
      setStatus(null)
      setLoadError(tt('vercel.apiMissing'))
      setLoadCode(undefined)
      return
    }
    setLoading(true)
    setLoadError(null)
    setLoadCode(undefined)
    try {
      const result = await window.vav.vercel.status(root)
      if (result.ok) {
        applyStatus(result.data)
        return
      }
      const local = await window.vav.vercel.status(root, { remote: false })
      if (local.ok && local.data.present) {
        applyStatus({
          ...local.data,
          remoteError: result.error,
          remoteCode: result.code
        })
        return
      }
      setStatus(null)
      setLoadError(result.error)
      setLoadCode(result.code)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      try {
        const local = await window.vav.vercel.status(root, { remote: false })
        if (local.ok && local.data.present) {
          applyStatus({
            ...local.data,
            remoteError: message,
            remoteCode: 'network'
          })
          return
        }
      } catch {
        // fall through
      }
      setStatus(null)
      setLoadError(message)
      setLoadCode('network')
    } finally {
      setLoading(false)
    }
  }, [root])

  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  const stableRefresh = useCallback(() => {
    void refreshRef.current()
  }, [])

  useEffect(() => {
    if (!visible) return
    void refresh()
  }, [visible, refresh, tokenPresent])

  const deploys = useMemo(() => status?.remote?.recent ?? [], [status])
  const latest = status?.remote?.latest ?? deploys[0] ?? null

  const chromeMeta = useMemo(() => {
    if (!status?.present) return null
    const name = status.remote?.name || status.config?.projectName || t('connector.vercel.name')
    if (!status.tokenPresent) return `${name} · ${t('vercel.localOnly')}`
    if (status.remote) return `${name} · ${statusLabel(latest?.status ?? 'unknown', t)}`
    if (status.remoteCode) return name
    return name
  }, [status, latest, t])

  useEffect(() => {
    if (!onChrome) return
    if (!visible || !root) {
      onChrome(null)
      return
    }
    onChrome({ meta: chromeMeta, loading: loading || deploying, refresh: stableRefresh })
  }, [onChrome, visible, root, chromeMeta, loading, deploying, stableRefresh])

  useEffect(() => {
    return () => onChrome?.(null)
  }, [onChrome])

  const deploy = async (): Promise<void> => {
    if (!root || deploying) return
    setDeploying(true)
    setDeployError(null)
    setDeploySummary(null)
    try {
      const result = await window.vav.connectors.act({
        connector: 'vercel',
        action: 'deploy',
        cwd: root
      })
      if (!result.ok) {
        setDeployError(result.error)
        return
      }
      setDeploySummary(result.summary)
      if (result.url) openUrl(result.url)
      void refresh()
    } catch (err) {
      setDeployError(err instanceof Error ? err.message : String(err))
    } finally {
      setDeploying(false)
    }
  }

  if (!root) {
    return (
      <div className="github-panel" data-testid="vercel-panel">
        <EmptyState title={t('vercel.needProject')} description={t('vercel.needProjectDesc')} />
      </div>
    )
  }

  if (loadError && !status) {
    return (
      <div className="github-panel" data-testid="vercel-panel">
        <EmptyState {...emptyForCode(loadCode, loadError, t)} />
      </div>
    )
  }

  if (!status) {
    return (
      <div className="github-panel" data-testid="vercel-panel">
        <EmptyState
          title={loading ? t('common.loading') : t('vercel.loadFailed')}
          description={loading ? undefined : t('vercel.apiMissing')}
        />
      </div>
    )
  }

  if (!status.present) {
    return (
      <div className="github-panel" data-testid="vercel-panel">
        <EmptyState title={t('vercel.emptyTitle')} description={t('vercel.emptyDesc')} />
      </div>
    )
  }

  const name = status.remote?.name || status.config?.projectName || t('connector.vercel.name')
  const url = latest?.url || status.remote?.dashboardUrl
  const dash = status.remote?.dashboardUrl

  return (
    <div className="github-panel" data-testid="vercel-panel">
      <div className="github-panel-body is-list-only">
        <div className="github-list-pane">
          <div className="github-detail-hero">
            <div className="github-detail-status-row">
              <span className={`github-detail-state ${latest ? statusClass(latest.status) : 'is-draft'}`}>
                {latest ? statusLabel(latest.status, t) : t('vercel.noDeploy')}
              </span>
              <span className="github-preview-title" title={name}>
                {name}
              </span>
              {url ? (
                <Button
                  icon={<ExternalLink size={14} />}
                  size="sm"
                  className="github-open-web"
                  title={t('vercel.open')}
                  onClick={() => openUrl(url)}
                />
              ) : null}
            </div>
            <p className="github-merge-prose">
              {latest?.createdAt
                ? `${t('vercel.latest')} · ${relativeTime(Date.parse(latest.createdAt))}`
                : status.config?.relativePath || t('vercel.noDeploy')}
            </p>
            <div className="github-detail-status-row">
              <Button
                label={deploying ? t('connector.deploying') : t('connector.deploy')}
                variant="secondary"
                size="sm"
                disabled={deploying}
                testId="vercel-deploy"
                onClick={() => void deploy()}
              />
              {!status.tokenPresent ? (
                <button
                  type="button"
                  className="github-site-link"
                  onClick={() => openSettings('connectors')}
                >
                  {t('vercel.openSettings')}
                </button>
              ) : null}
              {dash ? (
                <button type="button" className="github-site-link" onClick={() => openUrl(dash)}>
                  {t('vercel.openDashboard')}
                </button>
              ) : null}
            </div>
            {deployError ? <p className="github-merge-prose">{deployError}</p> : null}
            {deploySummary ? <p className="github-merge-prose">{deploySummary}</p> : null}
          </div>
          <div className="github-pr-list" role="listbox" aria-label={t('vercel.deployments')}>
            <div className="github-group-head">
              <span className="github-group-toggle is-static">
                <Triangle size={12} aria-hidden />
                <span>{t('vercel.deployments')}</span>
              </span>
            </div>
            {!status.tokenPresent ? (
              <div className="github-group-empty">
                <span>{t('vercel.needAuthLocal')}</span>
                <button
                  type="button"
                  className="github-site-link"
                  onClick={() => openSettings('connectors')}
                >
                  {t('vercel.openSettings')}
                </button>
              </div>
            ) : status.remoteError && !status.remote ? (
              <div className="github-group-empty">
                {emptyForCode(status.remoteCode ?? undefined, status.remoteError, t).description}
              </div>
            ) : deploys.length === 0 ? (
              <div className="github-group-empty">{t('vercel.noDeploy')}</div>
            ) : (
              deploys.map((row) => {
                const created = row.createdAt ? Date.parse(row.createdAt) : Number.NaN
                return (
                  <button
                    type="button"
                    role="option"
                    key={row.id}
                    className="github-pr-row"
                    onClick={() => {
                      if (row.url) openUrl(row.url)
                    }}
                  >
                    <span className={`github-pr-state ${statusClass(row.status)}`} aria-hidden>
                      <StatusIcon status={row.status} />
                    </span>
                    <span className="github-pr-title" title={row.name}>
                      {row.name}
                    </span>
                    <span className="github-pr-age">
                      {Number.isFinite(created) ? relativeTime(created) : ''}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
