import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import {
  Check,
  CircleDashed,
  Cloud,
  ExternalLink,
  LoaderCircle,
  X
} from 'lucide-react'
import type {
  CloudflareDeployStatus,
  CloudflareDeployment,
  CloudflareErrorCode,
  CloudflareKind,
  CloudflareStatus
} from '@shared/cloudflare'
import { collectCloudflareDeployments } from '@shared/cloudflare'
import { useSessionStore } from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { useT, tt } from '../i18n/useT'
import { relativeTime } from '../lib/format'
import { openFileInSessionPreview } from '../lib/openSessionFile'
import { Button, EmptyState } from './ui'
import { SafariIcon } from './SafariIcon'
import { showMenu, type MenuItem } from '../lib/nativeMenu'

export type CloudflarePanelChrome = {
  meta: string | null
  loading: boolean
  refresh: () => void
}

function kindLabel(kind: CloudflareKind | null | undefined, t: ReturnType<typeof useT>): string {
  if (kind === 'pages') return t('cloudflare.pages')
  if (kind === 'workers') return t('cloudflare.workers')
  return t('cloudflare.kindUnknown')
}

function statusLabel(status: CloudflareDeployStatus, t: ReturnType<typeof useT>): string {
  if (status === 'success') return t('cloudflare.statusSuccess')
  if (status === 'failure') return t('cloudflare.statusFailure')
  if (status === 'pending') return t('cloudflare.statusPending')
  if (status === 'canceled') return t('cloudflare.statusCanceled')
  return t('cloudflare.statusUnknown')
}

function statusClass(status: CloudflareDeployStatus): string {
  if (status === 'success') return 'is-merged'
  if (status === 'failure') return 'is-closed'
  if (status === 'pending') return 'is-open'
  return 'is-draft'
}

function StatusIcon({
  status,
  size = 12
}: {
  status: CloudflareDeployStatus
  size?: number
}): React.JSX.Element {
  if (status === 'success') return <Check size={size} />
  if (status === 'failure') return <X size={size} />
  if (status === 'pending') return <LoaderCircle size={size} className="github-action-spin" />
  return <CircleDashed size={size} />
}

function emptyForCode(
  code: CloudflareErrorCode | undefined,
  fallback: string,
  t: ReturnType<typeof useT>
): { title: string; description: string } {
  if (code === 'auth') {
    return { title: t('cloudflare.authFailed'), description: t('cloudflare.authFailedDesc') }
  }
  if (code === 'not-found') {
    return { title: t('cloudflare.notFound'), description: t('cloudflare.notFoundDesc') }
  }
  if (code === 'no-account') {
    return { title: t('cloudflare.noAccount'), description: t('cloudflare.noAccountDesc') }
  }
  if (code === 'no-config') {
    return { title: t('cloudflare.noConfig'), description: t('cloudflare.noConfigDesc') }
  }
  if (code === 'network') {
    return { title: t('cloudflare.loadFailed'), description: t('cloudflare.networkDesc') }
  }
  return { title: t('cloudflare.loadFailed'), description: fallback }
}

function hostOf(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return url.replace(/^https?:\/\//, '').replace(/\/$/, '')
  }
}

/** Session-right preview: selected Workers / Pages deployment. */
export function CloudflareDeployPreview({
  status,
  deploymentId,
  onClose
}: {
  status: CloudflareStatus
  deploymentId: string | null
  onClose: () => void
}): React.JSX.Element {
  const t = useT()
  const deploys = collectCloudflareDeployments(status)
  const selected = deploys.find((row) => row.id === deploymentId) ?? deploys[0] ?? null
  const title =
    selected?.url ||
    status.remote?.name ||
    status.config?.name ||
    t('cloudflare.project')
  const dash = status.remote?.dashboardUrl
  const preview = selected?.url ?? status.remote?.latest?.url ?? null
  return (
    <div className="github-preview">
      <header className="workspace-preview-chrome">
        <span className="github-preview-title" title={title}>
          {title}
        </span>
        {preview ? (
          <Button
            icon={<SafariIcon size={14} />}
            size="sm"
            title={t('cloudflare.openPreview')}
            onClick={() => window.open(preview, '_blank', 'noopener,noreferrer')}
          />
        ) : null}
        {dash ? (
          <Button
            icon={<ExternalLink size={14} />}
            size="sm"
            title={t('cloudflare.openDashboard')}
            onClick={() => window.open(dash, '_blank', 'noopener,noreferrer')}
          />
        ) : null}
        <Button icon={<X size={14} />} size="sm" title={t('common.close')} onClick={onClose} />
      </header>
      <div className="github-detail-pane">
        <ProjectPane status={status} selected={selected} showOpen={false} />
      </div>
    </div>
  )
}

/** Files tray → Cloudflare: this workspace’s Workers / Pages status. */
export function CloudflarePanel({
  visible,
  onChrome
}: {
  visible: boolean
  onChrome?: (chrome: CloudflarePanelChrome | null) => void
}): React.JSX.Element {
  const t = useT()
  const activeId = useSessionStore((s) => s.activeId)
  const previewHost = useSessionStore((s) => s.filePreviewHost)
  const filePreviewOpen = useSessionStore((s) => s.filePreviewOpen)
  const sessionPreview = useSessionStore((s) => s.sessionPreview)
  const setSessionPreview = useSessionStore((s) => s.setSessionPreview)
  const setFilePreviewOpen = useSessionStore((s) => s.setFilePreviewOpen)
  const openSettings = useSessionStore((s) => s.openSettings)
  const tokenPresent = useSessionStore((s) => s.settings.cloudflareApiTokenPresent === true)
  const accountSetting = useSessionStore((s) => s.settings.cloudflareAccountId)
  const root = useWorkspaceStore((s) => s.workspaces[activeId]?.root ?? null)

  const [status, setStatus] = useState<CloudflareStatus | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadCode, setLoadCode] = useState<CloudflareErrorCode | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [focusIndex, setFocusIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const applyStatus = (next: CloudflareStatus): void => {
    setStatus(next)
    const deploys = collectCloudflareDeployments(next)
    setSelectedId((prev) => {
      if (prev && deploys.some((row) => row.id === prev)) return prev
      return deploys[0]?.id ?? null
    })
  }

  const refresh = useCallback(async (): Promise<void> => {
    if (!root) {
      setStatus(null)
      setSelectedId(null)
      setLoadError(null)
      setLoadCode(undefined)
      return
    }
    if (!window.vav?.cloudflare?.status) {
      setStatus(null)
      setLoadError(tt('cloudflare.apiMissing'))
      setLoadCode(undefined)
      return
    }
    setLoading(true)
    setLoadError(null)
    setLoadCode(undefined)
    try {
      const result = await window.vav.cloudflare.status(root)
      if (result.ok) {
        applyStatus(result.data)
        return
      }
      const local = await window.vav.cloudflare.status(root, { remote: false })
      if (local.ok && local.data.config) {
        applyStatus({
          ...local.data,
          remoteError: result.error,
          remoteCode: result.code
        })
        return
      }
      setStatus(null)
      setSelectedId(null)
      setLoadError(result.error)
      setLoadCode(result.code)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      try {
        const local = await window.vav.cloudflare.status(root, { remote: false })
        if (local.ok && local.data.config) {
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
  }, [visible, refresh, tokenPresent, accountSetting])

  const deploys = useMemo(() => (status ? collectCloudflareDeployments(status) : []), [status])

  const chromeMeta = useMemo(() => {
    if (!status?.config) return null
    const name = status.config.name || t('cloudflare.unnamed')
    const kind = kindLabel(status.remote?.kind ?? status.config.kind, t)
    if (!status.tokenPresent) return `${name} · ${kind} · ${t('cloudflare.localOnly')}`
    if (status.tokenSource === 'wrangler' && !status.remote) {
      return `${name} · ${kind} · ${t('cloudflare.viaWrangler')}`
    }
    if (status.remote) {
      return `${name} · ${kind} · ${t('cloudflare.deployCount', { n: deploys.length })}`
    }
    if (status.remoteCode) return `${name} · ${kind}`
    return `${name} · ${kind}`
  }, [status, deploys.length, t])

  useEffect(() => {
    if (!onChrome) return
    if (!visible || !root) {
      onChrome(null)
      return
    }
    onChrome({ meta: chromeMeta, loading, refresh: stableRefresh })
  }, [onChrome, visible, root, chromeMeta, loading, stableRefresh])

  useEffect(() => {
    return () => onChrome?.(null)
  }, [onChrome])

  useEffect(() => {
    if (!visible || !previewHost || !root || !filePreviewOpen) return
    if (sessionPreview.kind !== 'cloudflare') return
    if (!status) return
    setSessionPreview({ kind: 'cloudflare', cwd: root, status, deploymentId: selectedId })
  }, [
    visible,
    previewHost,
    root,
    filePreviewOpen,
    sessionPreview.kind,
    status,
    selectedId,
    setSessionPreview
  ])

  const previewDeploy = (id: string | null): void => {
    if (!root || !status) return
    setSelectedId(id)
    setSessionPreview({ kind: 'cloudflare', cwd: root, status, deploymentId: id })
    setFilePreviewOpen(true)
  }

  const showDeployMenu = (row: CloudflareDeployment, x: number, y: number): void => {
    const items: MenuItem[] = [{ label: t('common.preview'), onSelect: () => previewDeploy(row.id) }]
    if (row.url) {
      items.push({
        label: t('cloudflare.openPreview'),
        onSelect: () => window.open(row.url!, '_blank', 'noopener,noreferrer')
      })
    }
    if (status?.remote?.dashboardUrl) {
      items.push({
        label: t('cloudflare.openDashboard'),
        onSelect: () => window.open(status.remote!.dashboardUrl!, '_blank', 'noopener,noreferrer')
      })
    }
    void showMenu(items, { x, y })
  }

  const onListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (deploys.length === 0) return
    const reveal = (index: number): void => {
      requestAnimationFrame(() => {
        listRef.current
          ?.querySelector(`[data-cf-deploy-row="${index}"]`)
          ?.scrollIntoView({ block: 'nearest' })
      })
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setFocusIndex((prev) => {
        const next = Math.max(0, Math.min(deploys.length - 1, prev + (event.key === 'ArrowDown' ? 1 : -1)))
        const row = deploys[next]
        if (row) setSelectedId(row.id)
        reveal(next)
        return next
      })
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const next = event.key === 'Home' ? 0 : deploys.length - 1
      const row = deploys[next]
      if (row) setSelectedId(row.id)
      setFocusIndex(next)
      reveal(next)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const row = deploys[focusIndex]
      if (row) previewDeploy(row.id)
    }
  }

  if (!root) {
    return (
      <div className="github-panel">
        <EmptyState title={t('cloudflare.needProject')} description={t('cloudflare.needProjectDesc')} />
      </div>
    )
  }

  if (loadError && !status) {
    return (
      <div className="github-panel">
        <EmptyState {...emptyForCode(loadCode, loadError, t)} />
      </div>
    )
  }

  if (!status) {
    return (
      <div className="github-panel">
        <EmptyState
          title={loading ? t('common.loading') : t('cloudflare.loadFailed')}
          description={loading ? undefined : t('cloudflare.apiMissing')}
        />
      </div>
    )
  }

  if (!status.config) {
    return (
      <div className="github-panel">
        <EmptyState title={t('cloudflare.noConfig')} description={t('cloudflare.noConfigDesc')} />
      </div>
    )
  }

  const selected = deploys.find((row) => row.id === selectedId) ?? deploys[0] ?? null

  return (
    <div className="github-panel">
      <div className={`github-panel-body${previewHost ? ' is-list-only' : ''}`}>
        <div className="github-list-pane">
          <ProjectSummary
            status={status}
            onPreview={() => previewDeploy(selected?.id ?? null)}
            onOpenSettings={() => openSettings('workspace')}
          />
          <div
            ref={listRef}
            className="github-pr-list"
            role="listbox"
            tabIndex={0}
            aria-label={t('cloudflare.deployments')}
            onKeyDown={onListKeyDown}
          >
            <div className="github-group-head">
              <span className="github-group-toggle is-static">
                <Cloud size={12} aria-hidden />
                <span>{t('cloudflare.deployments')}</span>
              </span>
              {status.remote?.dashboardUrl ? (
                <button
                  type="button"
                  className="github-group-web"
                  title={t('cloudflare.openDashboard')}
                  onClick={() =>
                    window.open(status.remote!.dashboardUrl!, '_blank', 'noopener,noreferrer')
                  }
                >
                  <ExternalLink size={11} />
                </button>
              ) : null}
            </div>
            {!status.tokenPresent ? (
              <div className="github-group-empty">
                <span>{t('cloudflare.needAuthLocal')}</span>
                <button
                  type="button"
                  className="github-site-link"
                  onClick={() => openSettings('workspace')}
                >
                  {t('cloudflare.openSettings')}
                </button>
              </div>
            ) : status.remoteError && !status.remote ? (
              <div className="github-group-empty">
                {emptyForCode(status.remoteCode ?? undefined, status.remoteError, t).description}
              </div>
            ) : deploys.length === 0 ? (
              <div className="github-group-empty">{t('cloudflare.noDeploys')}</div>
            ) : (
              deploys.map((row, index) => (
                <DeployRow
                  key={row.id}
                  row={row}
                  index={index}
                  selected={row.id === selectedId}
                  focused={index === focusIndex}
                  onSelect={() => {
                    setFocusIndex(index)
                    setSelectedId(row.id)
                  }}
                  onPreview={() => previewDeploy(row.id)}
                  onMenu={(x, y) => showDeployMenu(row, x, y)}
                />
              ))
            )}
          </div>
        </div>
        {!previewHost ? (
          <div className="github-detail-pane">
            <ProjectPane status={status} selected={selected} showOpen />
          </div>
        ) : null}
      </div>
    </div>
  )
}

function ProjectSummary({
  status,
  onPreview,
  onOpenSettings
}: {
  status: CloudflareStatus
  onPreview: () => void
  onOpenSettings: () => void
}): React.JSX.Element {
  const t = useT()
  const config = status.config
  const latest = status.remote?.latest ?? null
  const name = status.remote?.name || config?.name || t('cloudflare.unnamed')
  const kind = kindLabel(status.remote?.kind ?? config?.kind, t)
  const url = latest?.url ?? null
  return (
    <div
      className="github-detail-hero"
      onDoubleClick={onPreview}
      onContextMenu={(event) => {
        event.preventDefault()
        const items: MenuItem[] = [{ label: tt('common.preview'), onSelect: onPreview }]
        if (url) {
          items.push({
            label: tt('cloudflare.openPreview'),
            onSelect: () => window.open(url, '_blank', 'noopener,noreferrer')
          })
        }
        if (!status.tokenPresent) {
          items.push({ label: tt('cloudflare.openSettings'), onSelect: onOpenSettings })
        }
        void showMenu(items, { x: event.clientX, y: event.clientY })
      }}
    >
      <div className="github-detail-status-row">
        <span
          className={`github-detail-state ${latest ? statusClass(latest.status) : 'is-draft'}`}
        >
          {latest
            ? statusLabel(latest.status, t)
            : status.tokenSource === 'wrangler'
              ? t('cloudflare.viaWrangler')
              : t('cloudflare.localOnly')}
        </span>
        <button type="button" className="github-site-link" onClick={onPreview} title={name}>
          {name}
        </button>
        <span className="github-pr-age">{kind}</span>
        {url ? (
          <Button
            icon={<SafariIcon size={14} />}
            size="sm"
            className="github-open-web"
            title={t('cloudflare.openPreview')}
            onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
          />
        ) : null}
      </div>
      {latest?.createdAt ? (
        <p className="github-merge-prose">
          {t('cloudflare.latest')}
          {` · ${relativeTime(Date.parse(latest.createdAt))}`}
        </p>
      ) : config ? (
        <p className="github-merge-prose">{config.relativePath}</p>
      ) : null}
    </div>
  )
}

function ProjectPane({
  status,
  selected,
  showOpen
}: {
  status: CloudflareStatus
  selected: CloudflareDeployment | null
  showOpen: boolean
}): React.JSX.Element {
  const t = useT()
  const config = status.config
  const remote = status.remote
  const kind = kindLabel(remote?.kind ?? config?.kind, t)
  const name = remote?.name || config?.name || t('cloudflare.unnamed')
  const url = selected?.url ?? remote?.latest?.url ?? null
  const dash = remote?.dashboardUrl
  const created = selected?.createdAt ? Date.parse(selected.createdAt) : Number.NaN
  return (
    <div className="github-site">
      <div className="github-detail-scroll">
        <div className="github-detail-hero">
          <div className="github-detail-status-row">
            <span
              className={`github-detail-state ${
                selected ? statusClass(selected.status) : 'is-draft'
              }`}
            >
              {selected
                ? statusLabel(selected.status, t)
                : status.tokenSource === 'wrangler'
                  ? t('cloudflare.viaWrangler')
                  : t('cloudflare.localOnly')}
            </span>
            {url ? (
              <button
                type="button"
                className="github-site-link"
                onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
              >
                {hostOf(url) || url}
              </button>
            ) : (
              <p className="github-merge-prose">{name}</p>
            )}
            {showOpen && url ? (
              <Button
                icon={<SafariIcon size={14} />}
                size="sm"
                className="github-open-web"
                title={t('cloudflare.openPreview')}
                onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
              />
            ) : null}
            {showOpen && dash ? (
              <button
                type="button"
                className="github-site-config"
                title={t('cloudflare.openDashboard')}
                onClick={() => window.open(dash, '_blank', 'noopener,noreferrer')}
              >
                <span>{t('cloudflare.config')}</span>
                <ExternalLink size={11} aria-hidden />
              </button>
            ) : null}
          </div>
          {Number.isFinite(created) ? (
            <p className="github-merge-prose">
              {t('cloudflare.deployedAt')}
              {` · ${relativeTime(created)}`}
            </p>
          ) : null}
        </div>
        <div className="github-detail-body">
          <div className="github-site-fields-wrap">
            <SiteField label={t('cloudflare.kind')}>{kind}</SiteField>
            {config?.relativePath ? (
              <SiteField label={t('cloudflare.configPath')}>
                <button
                  type="button"
                  className="github-site-link"
                  onClick={() => openFileInSessionPreview(config.path)}
                >
                  {config.relativePath}
                </button>
              </SiteField>
            ) : null}
            {config?.compatibilityDate ? (
              <SiteField label={t('cloudflare.compatibility')}>{config.compatibilityDate}</SiteField>
            ) : null}
            {config?.main ? <SiteField label={t('cloudflare.entry')}>{config.main}</SiteField> : null}
            {config?.pagesOutputDir ? (
              <SiteField label={t('cloudflare.outputDir')}>{config.pagesOutputDir}</SiteField>
            ) : null}
            {config?.assetsDir ? (
              <SiteField label={t('cloudflare.outputDir')}>{config.assetsDir}</SiteField>
            ) : null}
            {status.accountId ? (
              <SiteField label={t('cloudflare.account')}>{status.accountId}</SiteField>
            ) : null}
            {selected?.environment ? (
              <SiteField label={t('cloudflare.environment')}>{selected.environment}</SiteField>
            ) : null}
            {selected?.source ? (
              <SiteField label={t('cloudflare.source')}>{selected.source}</SiteField>
            ) : null}
            {url ? (
              <SiteField label={t('cloudflare.deployUrl')}>
                <button
                  type="button"
                  className="github-site-link"
                  onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
                >
                  {url}
                </button>
              </SiteField>
            ) : selected ? (
              <SiteField label={t('cloudflare.deployUrl')}>{t('cloudflare.noUrl')}</SiteField>
            ) : null}
            {status.extraConfigs > 0 ? (
              <SiteField label={t('cloudflare.config')}>
                {t('cloudflare.extraConfigs', { n: status.extraConfigs })}
              </SiteField>
            ) : null}
            {config && config.bindings.length > 0 ? (
              <SiteField label={t('cloudflare.bindings')}>
                {config.bindings
                  .map((b) => t('cloudflare.binding', { kind: b.kind, name: b.binding }))
                  .join(', ')}
              </SiteField>
            ) : null}
            {config && config.environments.length > 0 ? (
              <SiteField label={t('cloudflare.environments')}>
                {config.environments
                  .map((env) => (env.projectName ? `${env.name} (${env.projectName})` : env.name))
                  .join(', ')}
              </SiteField>
            ) : null}
            {status.ciHints.length > 0 ? (
              <SiteField label={t('cloudflare.ci')}>
                {status.ciHints.map((hint) => hint.label).join(', ')}
              </SiteField>
            ) : null}
            {!config?.name ? (
              <SiteField label={t('cloudflare.project')}>{t('cloudflare.noNameDesc')}</SiteField>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function SiteField({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="github-site-field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function DeployRow({
  row,
  index,
  selected,
  focused,
  onSelect,
  onPreview,
  onMenu
}: {
  row: CloudflareDeployment
  index: number
  selected: boolean
  focused: boolean
  onSelect: () => void
  onPreview: () => void
  onMenu: (x: number, y: number) => void
}): React.JSX.Element {
  const created = row.createdAt ? Date.parse(row.createdAt) : Number.NaN
  const label = row.environment || row.source || row.id
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      data-cf-deploy-row={index}
      className={`github-pr-row${selected ? ' is-selected' : ''}${focused ? ' is-focused' : ''}`}
      onClick={onSelect}
      onDoubleClick={onPreview}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onSelect()
        onMenu(event.clientX, event.clientY)
      }}
    >
      <span className={`github-pr-state ${statusClass(row.status)}`} aria-hidden>
        <StatusIcon status={row.status} />
      </span>
      <span className="github-pr-title" title={label}>
        {label}
      </span>
      <span className="github-pr-age">{Number.isFinite(created) ? relativeTime(created) : ''}</span>
    </button>
  )
}
