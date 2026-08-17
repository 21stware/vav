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
  ExternalLink,
  FileCode,
  LoaderCircle,
  X
} from 'lucide-react'
import type {
  SupabaseErrorCode,
  SupabaseFunction,
  SupabaseFunctionStatus,
  SupabaseProjectStatus,
  SupabaseStatus
} from '@shared/supabase'
import {
  supabaseDashboardFunctionUrl,
  supabaseDashboardFunctionsUrl,
  supabaseDashboardProjectUrl
} from '@shared/supabase'
import { useSessionStore } from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { useT, tt } from '../i18n/useT'
import { relativeTime } from '../lib/format'
import { openFileInSessionPreview } from '../lib/openSessionFile'
import { Button, EmptyState } from './ui'
import { SafariIcon } from './SafariIcon'
import { showMenu, type MenuItem } from '../lib/nativeMenu'
import { SupabaseMark } from './SupabaseMark'

export type SupabasePanelChrome = {
  meta: string | null
  loading: boolean
  refresh: () => void
}

function projectStatusLabel(
  status: SupabaseProjectStatus | null | undefined,
  t: ReturnType<typeof useT>
): string {
  if (status === 'healthy') return t('supabase.statusHealthy')
  if (status === 'unhealthy') return t('supabase.statusUnhealthy')
  if (status === 'coming-up') return t('supabase.statusComingUp')
  if (status === 'paused') return t('supabase.statusPaused')
  return t('supabase.statusUnknown')
}

function functionStatusLabel(
  status: SupabaseFunctionStatus,
  t: ReturnType<typeof useT>
): string {
  if (status === 'active') return t('supabase.statusActive')
  if (status === 'unhealthy') return t('supabase.statusUnhealthy')
  if (status === 'coming-up') return t('supabase.statusComingUp')
  if (status === 'removed') return t('supabase.statusRemoved')
  if (status === 'local') return t('supabase.statusLocal')
  return t('supabase.statusUnknown')
}

function functionStatusClass(status: SupabaseFunctionStatus): string {
  if (status === 'active') return 'is-merged'
  if (status === 'unhealthy' || status === 'removed') return 'is-closed'
  if (status === 'coming-up') return 'is-open'
  return 'is-draft'
}

function projectStatusClass(status: SupabaseProjectStatus | null | undefined): string {
  if (status === 'healthy') return 'is-merged'
  if (status === 'unhealthy') return 'is-closed'
  if (status === 'coming-up') return 'is-open'
  return 'is-draft'
}

function StatusIcon({
  status,
  size = 12
}: {
  status: SupabaseFunctionStatus
  size?: number
}): React.JSX.Element {
  if (status === 'active') return <Check size={size} />
  if (status === 'unhealthy' || status === 'removed') return <X size={size} />
  if (status === 'coming-up') return <LoaderCircle size={size} className="github-action-spin" />
  return <CircleDashed size={size} />
}

function emptyForCode(
  code: SupabaseErrorCode | undefined,
  fallback: string,
  t: ReturnType<typeof useT>
): { title: string; description: string } {
  if (code === 'auth') {
    return { title: t('supabase.authFailed'), description: t('supabase.authFailedDesc') }
  }
  if (code === 'not-found') {
    return { title: t('supabase.notFound'), description: t('supabase.notFoundDesc') }
  }
  if (code === 'no-ref') {
    return { title: t('supabase.noRef'), description: t('supabase.noRefDesc') }
  }
  if (code === 'no-config') {
    return { title: t('supabase.noConfig'), description: t('supabase.noConfigDesc') }
  }
  if (code === 'network') {
    return { title: t('supabase.loadFailed'), description: t('supabase.networkDesc') }
  }
  return { title: t('supabase.loadFailed'), description: fallback }
}

/** Session-right preview: selected Edge Function. */
export function SupabaseFunctionPreview({
  status,
  functionSlug,
  onClose
}: {
  status: SupabaseStatus
  functionSlug: string | null
  onClose: () => void
}): React.JSX.Element {
  const t = useT()
  const selected =
    status.functions.find((row) => row.slug === functionSlug) ?? status.functions[0] ?? null
  const title = selected?.name || selected?.slug || status.remote?.project?.name || t('supabase.project')
  const dash = selected
    ? status.projectRef
      ? supabaseDashboardFunctionUrl(status.projectRef, selected.slug)
      : null
    : status.projectRef
      ? supabaseDashboardProjectUrl(status.projectRef)
      : null
  return (
    <div className="github-preview">
      <header className="workspace-preview-chrome">
        <span className="github-preview-title" title={title}>
          {title}
        </span>
        {selected?.localPath ? (
          <Button
            icon={<FileCode size={14} />}
            size="sm"
            title={t('supabase.openSource')}
            onClick={() => openFileInSessionPreview(selected.localPath!)}
          />
        ) : null}
        {dash ? (
          <Button
            icon={<ExternalLink size={14} />}
            size="sm"
            title={t('supabase.openDashboard')}
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

/** Files tray → Supabase: this workspace’s project and Edge Functions. */
export function SupabasePanel({
  visible,
  onChrome
}: {
  visible: boolean
  onChrome?: (chrome: SupabasePanelChrome | null) => void
}): React.JSX.Element {
  const t = useT()
  const activeId = useSessionStore((s) => s.activeId)
  const previewHost = useSessionStore((s) => s.filePreviewHost)
  const filePreviewOpen = useSessionStore((s) => s.filePreviewOpen)
  const sessionPreview = useSessionStore((s) => s.sessionPreview)
  const setSessionPreview = useSessionStore((s) => s.setSessionPreview)
  const setFilePreviewOpen = useSessionStore((s) => s.setFilePreviewOpen)
  const openSettings = useSessionStore((s) => s.openSettings)
  const tokenPresent = useSessionStore((s) => s.settings.supabaseAccessTokenPresent === true)
  const refSetting = useSessionStore((s) => s.settings.supabaseProjectRef)
  const root = useWorkspaceStore((s) => s.workspaces[activeId]?.root ?? null)

  const [status, setStatus] = useState<SupabaseStatus | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadCode, setLoadCode] = useState<SupabaseErrorCode | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
  const [focusIndex, setFocusIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async (): Promise<void> => {
    if (!root) {
      setStatus(null)
      setSelectedSlug(null)
      setLoadError(null)
      setLoadCode(undefined)
      return
    }
    if (!window.vav?.supabase?.status) {
      setStatus(null)
      setLoadError(tt('supabase.apiMissing'))
      setLoadCode(undefined)
      return
    }
    setLoading(true)
    setLoadError(null)
    setLoadCode(undefined)
    try {
      const result = await window.vav.supabase.status(root)
      if (!result.ok) {
        setStatus(null)
        setSelectedSlug(null)
        setLoadError(result.error)
        setLoadCode(result.code)
        return
      }
      setStatus(result.data)
      setSelectedSlug((prev) => {
        if (prev && result.data.functions.some((row) => row.slug === prev)) return prev
        return result.data.functions[0]?.slug ?? null
      })
    } catch (err) {
      setStatus(null)
      setLoadError(err instanceof Error ? err.message : String(err))
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
  }, [visible, refresh, tokenPresent, refSetting])

  const chromeMeta = useMemo(() => {
    if (!status?.present) return null
    const name =
      status.remote?.project?.name || status.config?.projectId || status.projectRef || t('supabase.unnamed')
    if (!status.tokenPresent) return `${name} · ${t('supabase.localOnly')}`
    if (status.tokenSource === 'cli' && !status.remote) {
      return `${name} · ${t('supabase.viaCli')}`
    }
    if (status.remote?.project) {
      return `${name} · ${t('supabase.functionCount', { n: status.functions.length })}`
    }
    return name
  }, [status, t])

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
    if (sessionPreview.kind !== 'supabase') return
    if (!status) return
    setSessionPreview({ kind: 'supabase', cwd: root, status, functionSlug: selectedSlug })
  }, [
    visible,
    previewHost,
    root,
    filePreviewOpen,
    sessionPreview.kind,
    status,
    selectedSlug,
    setSessionPreview
  ])

  const previewFunction = (slug: string | null): void => {
    if (!root || !status) return
    setSelectedSlug(slug)
    setSessionPreview({ kind: 'supabase', cwd: root, status, functionSlug: slug })
    setFilePreviewOpen(true)
  }

  const showFunctionMenu = (row: SupabaseFunction, x: number, y: number): void => {
    const items: MenuItem[] = [{ label: t('common.preview'), onSelect: () => previewFunction(row.slug) }]
    if (row.localPath) {
      items.push({
        label: t('supabase.openSource'),
        onSelect: () => openFileInSessionPreview(row.localPath!)
      })
    }
    if (status?.projectRef) {
      items.push({
        label: t('supabase.openDashboard'),
        onSelect: () =>
          window.open(
            supabaseDashboardFunctionUrl(status.projectRef!, row.slug),
            '_blank',
            'noopener,noreferrer'
          )
      })
    }
    void showMenu(items, { x, y })
  }

  const functions = status?.functions ?? []

  const onListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (functions.length === 0) return
    const reveal = (index: number): void => {
      requestAnimationFrame(() => {
        listRef.current
          ?.querySelector(`[data-sb-fn-row="${index}"]`)
          ?.scrollIntoView({ block: 'nearest' })
      })
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setFocusIndex((prev) => {
        const next = Math.max(0, Math.min(functions.length - 1, prev + (event.key === 'ArrowDown' ? 1 : -1)))
        const row = functions[next]
        if (row) setSelectedSlug(row.slug)
        reveal(next)
        return next
      })
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const next = event.key === 'Home' ? 0 : functions.length - 1
      const row = functions[next]
      if (row) setSelectedSlug(row.slug)
      setFocusIndex(next)
      reveal(next)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const row = functions[focusIndex]
      if (row) previewFunction(row.slug)
    }
  }

  if (!root) {
    return (
      <div className="github-panel">
        <EmptyState title={t('supabase.needProject')} description={t('supabase.needProjectDesc')} />
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
          title={loading ? t('common.loading') : t('supabase.loadFailed')}
          description={loading ? undefined : t('supabase.apiMissing')}
        />
      </div>
    )
  }

  if (!status.present) {
    return (
      <div className="github-panel">
        <EmptyState title={t('supabase.noConfig')} description={t('supabase.noConfigDesc')} />
      </div>
    )
  }

  const selected = functions.find((row) => row.slug === selectedSlug) ?? functions[0] ?? null
  const dash =
    status.projectRef != null
      ? supabaseDashboardFunctionsUrl(status.projectRef)
      : status.remote?.project?.dashboardUrl ?? null

  return (
    <div className="github-panel">
      <div className={`github-panel-body${previewHost ? ' is-list-only' : ''}`}>
        <div className="github-list-pane">
          <ProjectSummary
            status={status}
            onPreview={() => previewFunction(selected?.slug ?? null)}
            onOpenSettings={() => openSettings('workspace')}
          />
          <div
            ref={listRef}
            className="github-pr-list"
            role="listbox"
            tabIndex={0}
            aria-label={t('supabase.functions')}
            onKeyDown={onListKeyDown}
          >
            <div className="github-group-head">
              <span className="github-group-toggle" style={{ cursor: 'default' }}>
                <SupabaseMark size={12} />
                <span>{t('supabase.functions')}</span>
              </span>
              {dash ? (
                <button
                  type="button"
                  className="github-group-web"
                  title={t('supabase.openDashboard')}
                  onClick={() => window.open(dash, '_blank', 'noopener,noreferrer')}
                >
                  <ExternalLink size={11} />
                </button>
              ) : null}
            </div>
            {!status.tokenPresent ? (
              <div className="github-group-empty">
                <span>{t('supabase.needAuthLocal')}</span>
                <button
                  type="button"
                  className="github-site-link"
                  onClick={() => openSettings('workspace')}
                >
                  {t('supabase.openSettings')}
                </button>
              </div>
            ) : status.remoteError && !status.remote ? (
              <div className="github-group-empty">
                {emptyForCode(status.remoteCode ?? undefined, status.remoteError, t).description}
              </div>
            ) : functions.length === 0 ? (
              <div className="github-group-empty">{t('supabase.noFunctions')}</div>
            ) : (
              functions.map((row, index) => (
                <FunctionRow
                  key={row.slug}
                  row={row}
                  index={index}
                  selected={row.slug === selectedSlug}
                  focused={index === focusIndex}
                  onSelect={() => {
                    setFocusIndex(index)
                    setSelectedSlug(row.slug)
                  }}
                  onPreview={() => previewFunction(row.slug)}
                  onMenu={(x, y) => showFunctionMenu(row, x, y)}
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
  status: SupabaseStatus
  onPreview: () => void
  onOpenSettings: () => void
}): React.JSX.Element {
  const t = useT()
  const project = status.remote?.project
  const name = project?.name || status.config?.projectId || status.projectRef || t('supabase.unnamed')
  const projectStatus = project?.status
  const dash = project?.dashboardUrl ?? (status.projectRef ? supabaseDashboardProjectUrl(status.projectRef) : null)
  return (
    <div
      className="github-detail-hero"
      onDoubleClick={onPreview}
      onContextMenu={(event) => {
        event.preventDefault()
        const items: MenuItem[] = [{ label: tt('common.preview'), onSelect: onPreview }]
        if (dash) {
          items.push({
            label: tt('supabase.openDashboard'),
            onSelect: () => window.open(dash, '_blank', 'noopener,noreferrer')
          })
        }
        if (!status.tokenPresent) {
          items.push({ label: tt('supabase.openSettings'), onSelect: onOpenSettings })
        }
        void showMenu(items, { x: event.clientX, y: event.clientY })
      }}
    >
      <div className="github-detail-status-row">
        <span className={`github-detail-state ${projectStatusClass(projectStatus)}`}>
          {project
            ? projectStatusLabel(projectStatus, t)
            : status.tokenSource === 'cli'
              ? t('supabase.viaCli')
              : t('supabase.localOnly')}
        </span>
        <button type="button" className="github-site-link" onClick={onPreview} title={name}>
          {name}
        </button>
        {project?.region ? <span className="github-pr-age">{project.region}</span> : null}
        {dash ? (
          <Button
            icon={<SafariIcon size={14} />}
            size="sm"
            className="github-open-web"
            title={t('supabase.openDashboard')}
            onClick={() => window.open(dash, '_blank', 'noopener,noreferrer')}
          />
        ) : null}
      </div>
      {status.config?.relativePath ? (
        <p className="github-merge-prose">{status.config.relativePath}</p>
      ) : status.projectRef ? (
        <p className="github-merge-prose">{status.projectRef}</p>
      ) : null}
    </div>
  )
}

function ProjectPane({
  status,
  selected,
  showOpen
}: {
  status: SupabaseStatus
  selected: SupabaseFunction | null
  showOpen: boolean
}): React.JSX.Element {
  const t = useT()
  const project = status.remote?.project
  const name = selected?.name || selected?.slug || project?.name || status.config?.projectId || t('supabase.unnamed')
  const dash = selected
    ? status.projectRef
      ? supabaseDashboardFunctionUrl(status.projectRef, selected.slug)
      : null
    : project?.dashboardUrl ?? (status.projectRef ? supabaseDashboardProjectUrl(status.projectRef) : null)
  const updated = selected?.updatedAt ? Date.parse(selected.updatedAt) : Number.NaN
  return (
    <div className="github-site">
      <div className="github-detail-scroll">
        <div className="github-detail-hero">
          <div className="github-detail-status-row">
            <span
              className={`github-detail-state ${
                selected ? functionStatusClass(selected.status) : projectStatusClass(project?.status)
              }`}
            >
              {selected
                ? functionStatusLabel(selected.status, t)
                : project
                  ? projectStatusLabel(project.status, t)
                  : status.tokenSource === 'cli'
                    ? t('supabase.viaCli')
                    : t('supabase.localOnly')}
            </span>
            <p className="github-merge-prose">{name}</p>
            {showOpen && selected?.localPath ? (
              <Button
                icon={<FileCode size={14} />}
                size="sm"
                className="github-open-web"
                title={t('supabase.openSource')}
                onClick={() => openFileInSessionPreview(selected.localPath!)}
              />
            ) : null}
            {showOpen && dash ? (
              <button
                type="button"
                className="github-site-config"
                title={t('supabase.openDashboard')}
                onClick={() => window.open(dash, '_blank', 'noopener,noreferrer')}
              >
                <span>{t('supabase.config')}</span>
                <ExternalLink size={11} aria-hidden />
              </button>
            ) : null}
          </div>
          {Number.isFinite(updated) ? (
            <p className="github-merge-prose">
              {t('supabase.updatedAt')}
              {` · ${relativeTime(updated)}`}
            </p>
          ) : null}
        </div>
        <div className="github-detail-body">
          <div className="github-site-fields-wrap">
            {project?.region ? <SiteField label={t('supabase.region')}>{project.region}</SiteField> : null}
            {status.projectRef ? <SiteField label={t('supabase.ref')}>{status.projectRef}</SiteField> : null}
            {project?.postgresVersion ? (
              <SiteField label={t('supabase.postgres')}>{project.postgresVersion}</SiteField>
            ) : null}
            {status.config?.relativePath ? (
              <SiteField label={t('supabase.configPath')}>
                <button
                  type="button"
                  className="github-site-link"
                  onClick={() => openFileInSessionPreview(status.config!.path)}
                >
                  {status.config.relativePath}
                </button>
              </SiteField>
            ) : null}
            {selected?.localRelativePath ? (
              <SiteField label={t('supabase.source')}>
                <button
                  type="button"
                  className="github-site-link"
                  onClick={() =>
                    selected.localPath ? openFileInSessionPreview(selected.localPath) : undefined
                  }
                >
                  {selected.localRelativePath}
                </button>
              </SiteField>
            ) : null}
            {selected?.version != null ? (
              <SiteField label={t('supabase.version')}>{String(selected.version)}</SiteField>
            ) : null}
            {selected?.verifyJwt != null ? (
              <SiteField label={t('supabase.verifyJwt')}>
                {selected.verifyJwt ? t('supabase.verifyJwtOn') : t('supabase.verifyJwtOff')}
              </SiteField>
            ) : null}
            {selected?.entrypoint ? (
              <SiteField label={t('supabase.entrypoint')}>{selected.entrypoint}</SiteField>
            ) : null}
            {selected?.invokeUrl ? (
              <SiteField label={t('supabase.invokeUrl')}>
                <button
                  type="button"
                  className="github-site-link"
                  onClick={() => window.open(selected.invokeUrl!, '_blank', 'noopener,noreferrer')}
                >
                  {selected.invokeUrl}
                </button>
              </SiteField>
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

function FunctionRow({
  row,
  index,
  selected,
  focused,
  onSelect,
  onPreview,
  onMenu
}: {
  row: SupabaseFunction
  index: number
  selected: boolean
  focused: boolean
  onSelect: () => void
  onPreview: () => void
  onMenu: (x: number, y: number) => void
}): React.JSX.Element {
  const updated = row.updatedAt ? Date.parse(row.updatedAt) : Number.NaN
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      data-sb-fn-row={index}
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
      <span className={`github-pr-state ${functionStatusClass(row.status)}`} aria-hidden>
        <StatusIcon status={row.status} />
      </span>
      <span className="github-pr-title" title={row.slug}>
        {row.slug}
      </span>
      <span className="github-pr-age">{Number.isFinite(updated) ? relativeTime(updated) : ''}</span>
    </button>
  )
}
