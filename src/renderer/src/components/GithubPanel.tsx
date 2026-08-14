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
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  LoaderCircle,
  MessageSquare,
  Play,
  Settings,
  X
} from 'lucide-react'
import type {
  GithubActionJob,
  GithubActionRun,
  GithubActionRunDetail,
  GithubActionStatus,
  GithubActionsPage,
  GithubComment,
  GithubErrorCode,
  GithubPullDetail,
  GithubPullListItem,
  GithubPullsPage,
  GithubPullState,
  GithubReview,
  GithubReviewState,
  GithubSite,
  GithubTrayTab
} from '@shared/github'
import {
  fillGithubSiteGaps,
  githubPagesCustomDomain,
  isGithubPagesLive,
  mergePullConversation
} from '@shared/github'
import { useSessionStore } from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { useT, tt } from '../i18n/useT'
import { relativeTime } from '../lib/format'
import { Button, EmptyState, Segmented } from './ui'
import { renderGithubMarkdown } from '../lib/githubMarkdown'
import { SafariIcon } from './SafariIcon'
import { showMenu, type MenuItem } from '../lib/nativeMenu'

export type GithubPanelChrome = {
  meta: string | null
  loading: boolean
  refresh: () => void
}

/** Session-right preview: selected pull request conversation. */
export function GithubPullPreview({
  cwd,
  pull,
  onClose
}: {
  cwd: string
  pull: GithubPullListItem
  onClose: () => void
}): React.JSX.Element {
  const t = useT()
  const [detail, setDetail] = useState<GithubPullDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!window.vav?.github?.getPull) {
      setDetail(null)
      setError(t('github.apiMissing'))
      setLoading(false)
      return
    }
    let cancelled = false
    setDetail(null)
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const result = await window.vav.github.getPull(cwd, pull.number)
        if (cancelled) return
        if (!result.ok) {
          setDetail(null)
          setError(result.error)
          return
        }
        setDetail(result.data)
      } catch (err) {
        if (cancelled) return
        setDetail(null)
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [cwd, pull.number, t])

  const live = detail && detail.number === pull.number ? detail : null
  const item = live ?? pull

  return (
    <div className="github-preview">
      <header className="workspace-preview-chrome">
        <span className="github-preview-title" title={item.title}>
          #{item.number} {item.title}
        </span>
        <Button
          icon={<SafariIcon size={14} />}
          size="sm"
          title={t('github.openOnGithub')}
          onClick={() => window.open(item.url, '_blank', 'noopener,noreferrer')}
        />
        <Button icon={<X size={14} />} size="sm" title={t('common.close')} onClick={onClose} />
      </header>
      <div className="github-detail-pane">
        <PullDetail
          item={item}
          detail={live}
          loading={loading}
          error={error}
          showOpen={false}
        />
      </div>
    </div>
  )
}

/** Session-right preview: selected running workflow. */
export function GithubActionPreview({
  cwd,
  run,
  onClose
}: {
  cwd: string
  run: GithubActionRun
  onClose: () => void
}): React.JSX.Element {
  const t = useT()
  const [detail, setDetail] = useState<GithubActionRunDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!window.vav?.github?.getActionRun) {
      setDetail(null)
      setError(t('github.apiMissing'))
      setLoading(false)
      return
    }
    let cancelled = false
    setDetail(null)
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const result = await window.vav.github.getActionRun(cwd, run.id)
        if (cancelled) return
        if (!result.ok) {
          setDetail(null)
          setError(result.error)
          return
        }
        setDetail(result.data)
      } catch (err) {
        if (cancelled) return
        setDetail(null)
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [cwd, run.id, t])

  const live = detail && detail.id === run.id ? detail : null
  const shown = live ?? run

  return (
    <div className="github-preview">
      <header className="workspace-preview-chrome">
        <span className="github-preview-title" title={shown.title || shown.name}>
          {shown.title || shown.name}
        </span>
        <Button
          icon={<SafariIcon size={14} />}
          size="sm"
          title={t('github.openOnGithub')}
          onClick={() => window.open(shown.htmlUrl, '_blank', 'noopener,noreferrer')}
        />
        <Button icon={<X size={14} />} size="sm" title={t('common.close')} onClick={onClose} />
      </header>
      <div className="github-detail-pane">
        <ActionDetail
          run={shown}
          detail={live}
          loading={loading}
          error={error}
          showOpen={false}
        />
      </div>
    </div>
  )
}

/** Session-right preview: GitHub Pages configuration. */
export function GithubSitePreview({
  site,
  onClose
}: {
  site: GithubSite
  onClose: () => void
}): React.JSX.Element {
  const t = useT()
  return (
    <div className="github-preview">
      <header className="workspace-preview-chrome">
        <span className="github-preview-title">{t('github.sitePages')}</span>
        <Button
          icon={<SafariIcon size={14} />}
          size="sm"
          title={t('github.openPagesSettings')}
          onClick={() => window.open(site.settingsUrl, '_blank', 'noopener,noreferrer')}
        />
        <Button icon={<X size={14} />} size="sm" title={t('common.close')} onClick={onClose} />
      </header>
      <div className="github-detail-pane">
        <SitePane site={site} loading={false} error={null} code={undefined} showOpen={false} />
      </div>
    </div>
  )
}

function PullStateIcon({
  state,
  draft,
  size = 12
}: {
  state: GithubPullState
  draft: boolean
  size?: number
}): React.JSX.Element {
  if (state === 'merged') return <GitMerge size={size} />
  if (state === 'closed') return <GitPullRequestClosed size={size} />
  if (draft && state === 'open') return <GitPullRequestDraft size={size} />
  return <GitPullRequest size={size} />
}

function stateClass(state: GithubPullState, draft: boolean): string {
  if (state === 'merged') return 'is-merged'
  if (state === 'closed') return 'is-closed'
  if (draft) return 'is-draft'
  return 'is-open'
}

function emptyForCode(
  code: GithubErrorCode | undefined,
  fallback: string,
  t: ReturnType<typeof useT>
): { title: string; description: string } {
  if (code === 'not-github' || code === 'no-remote') {
    return { title: t('github.notGithub'), description: t('github.notGithubDesc') }
  }
  if (code === 'auth') {
    return { title: t('github.needAuth'), description: t('github.needAuthDesc') }
  }
  if (code === 'rate-limit') {
    return { title: t('github.rateLimit'), description: t('github.rateLimitDesc') }
  }
  if (code === 'not-found') {
    return { title: t('github.notFound'), description: t('github.notFoundDesc') }
  }
  if (code === 'network') {
    return { title: t('github.loadFailed'), description: t('github.networkDesc') }
  }
  return { title: t('github.loadFailed'), description: fallback }
}

/** Files tray → GitHub: pull request list + selected PR details. */
export function GithubPanel({
  visible,
  onChrome
}: {
  visible: boolean
  onChrome?: (chrome: GithubPanelChrome | null) => void
}): React.JSX.Element {
  const t = useT()
  const activeId = useSessionStore((s) => s.activeId)
  const previewHost = useSessionStore((s) => s.filePreviewHost)
  const filePreviewOpen = useSessionStore((s) => s.filePreviewOpen)
  const sessionPreview = useSessionStore((s) => s.sessionPreview)
  const setSessionPreview = useSessionStore((s) => s.setSessionPreview)
  const setFilePreviewOpen = useSessionStore((s) => s.setFilePreviewOpen)
  const root = useWorkspaceStore((s) => s.workspaces[activeId]?.root ?? null)

  const [tab, setTab] = useState<GithubTrayTab>('pulls')
  const [page, setPage] = useState<GithubPullsPage | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [detail, setDetail] = useState<GithubPullDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadCode, setLoadCode] = useState<GithubErrorCode | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [focusIndex, setFocusIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const [actionsPage, setActionsPage] = useState<GithubActionsPage | null>(null)
  const [actionsError, setActionsError] = useState<string | null>(null)
  const [actionsCode, setActionsCode] = useState<GithubErrorCode | undefined>(undefined)
  const [actionsLoading, setActionsLoading] = useState(false)
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null)
  const [runDetail, setRunDetail] = useState<GithubActionRunDetail | null>(null)
  const [runDetailError, setRunDetailError] = useState<string | null>(null)
  const [runDetailLoading, setRunDetailLoading] = useState(false)
  const [actionFocusIndex, setActionFocusIndex] = useState(0)
  const actionListRef = useRef<HTMLDivElement>(null)

  const [site, setSite] = useState<GithubSite | null>(null)
  const [siteError, setSiteError] = useState<string | null>(null)
  const [siteCode, setSiteCode] = useState<GithubErrorCode | undefined>(undefined)
  const [siteLoading, setSiteLoading] = useState(false)

  const refreshPulls = useCallback(async (): Promise<void> => {
    if (!root) {
      setPage(null)
      setSelected(null)
      setDetail(null)
      setLoadError(null)
      setLoadCode(undefined)
      return
    }
    if (!window.vav?.github?.listPulls) {
      setPage(null)
      setLoadError(tt('github.apiMissing'))
      setLoadCode(undefined)
      return
    }
    setLoading(true)
    setLoadError(null)
    setLoadCode(undefined)
    try {
      const result = await window.vav.github.listPulls(root, 'open')
      if (!result.ok) {
        setPage(null)
        setSelected(null)
        setDetail(null)
        setLoadError(result.error)
        setLoadCode(result.code)
        return
      }
      setPage(result.data)
      setSelected((prev) => {
        if (prev && result.data.pulls.some((p) => p.number === prev)) return prev
        return null
      })
    } catch (err) {
      setPage(null)
      setLoadError(err instanceof Error ? err.message : String(err))
      setLoadCode('network')
    } finally {
      setLoading(false)
    }
  }, [root])

  const refreshActions = useCallback(async (): Promise<void> => {
    if (!root) {
      setActionsPage(null)
      setSelectedRunId(null)
      setRunDetail(null)
      setActionsError(null)
      setActionsCode(undefined)
      return
    }
    if (!window.vav?.github?.listActions) {
      setActionsPage(null)
      setActionsError(tt('github.apiMissing'))
      setActionsCode(undefined)
      return
    }
    setActionsLoading(true)
    setActionsError(null)
    setActionsCode(undefined)
    try {
      const result = await window.vav.github.listActions(root)
      if (!result.ok) {
        setActionsPage(null)
        setSelectedRunId(null)
        setRunDetail(null)
        setActionsError(result.error)
        setActionsCode(result.code)
        return
      }
      setActionsPage(result.data)
      setSelectedRunId((prev) => {
        if (prev && result.data.runs.some((run) => run.id === prev)) return prev
        return result.data.runs[0]?.id ?? null
      })
    } catch (err) {
      setActionsPage(null)
      setActionsError(err instanceof Error ? err.message : String(err))
      setActionsCode('network')
    } finally {
      setActionsLoading(false)
    }
  }, [root])

  const refreshSite = useCallback(async (): Promise<void> => {
    if (!root) {
      setSite(null)
      setSiteError(null)
      setSiteCode(undefined)
      return
    }
    if (!window.vav?.github?.getSite) {
      setSite(null)
      setSiteError(tt('github.apiMissing'))
      setSiteCode(undefined)
      return
    }
    setSiteLoading(true)
    setSiteError(null)
    setSiteCode(undefined)
    try {
      const result = await window.vav.github.getSite(root)
      if (!result.ok) {
        setSite(null)
        setSiteError(result.error)
        setSiteCode(result.code)
        return
      }
      setSite(result.data)
    } catch (err) {
      setSite(null)
      setSiteError(err instanceof Error ? err.message : String(err))
      setSiteCode('network')
    } finally {
      setSiteLoading(false)
    }
  }, [root])

  const refresh = useCallback(async (): Promise<void> => {
    if (tab === 'actions') return refreshActions()
    if (tab === 'site') return refreshSite()
    return refreshPulls()
  }, [tab, refreshActions, refreshSite, refreshPulls])

  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  const stableRefresh = useCallback(() => {
    void refreshRef.current()
  }, [])

  useEffect(() => {
    if (!visible) return
    void refresh()
  }, [visible, refresh])

  const chromeLoading =
    tab === 'actions' ? actionsLoading : tab === 'site' ? siteLoading : loading
  const chromeMeta = useMemo(() => {
    if (tab === 'actions') {
      if (!actionsPage) return null
      return `${actionsPage.repo.fullName} · ${t('github.actionCount', { n: actionsPage.runs.length })}`
    }
    if (tab === 'site') {
      if (!site) return null
      if (!isGithubPagesLive(site)) return `${site.repo.fullName} · ${t('github.noSite')}`
      return `${site.repo.fullName} · ${site.pagesStatus || t('github.sitePages')}`
    }
    if (!page) return null
    return `${page.repo.fullName} · ${
      page.truncated
        ? t('github.pullCountTruncated', { n: page.pulls.length })
        : t('github.pullCount', { n: page.pulls.length })
    }`
  }, [tab, actionsPage, site, page, t])

  useEffect(() => {
    if (!onChrome) return
    if (!visible || !root) {
      onChrome(null)
      return
    }
    onChrome({ meta: chromeMeta, loading: chromeLoading, refresh: stableRefresh })
  }, [onChrome, visible, root, chromeMeta, chromeLoading, stableRefresh])

  useEffect(() => {
    return () => onChrome?.(null)
  }, [onChrome])

  useEffect(() => {
    if (!visible || !previewHost || !root || !filePreviewOpen) return
    if (tab === 'actions') {
      if (sessionPreview.kind !== 'github-action') return
      const run = (actionsPage?.runs ?? []).find((item) => item.id === selectedRunId)
      if (!run) return
      setSessionPreview({ kind: 'github-action', cwd: root, run })
      return
    }
    if (tab === 'site') return
    if (sessionPreview.kind !== 'github') return
    if (selected == null) return
    const pull = (page?.pulls ?? []).find((item) => item.number === selected)
    if (!pull) return
    setSessionPreview({ kind: 'github', cwd: root, pull })
  }, [
    visible,
    previewHost,
    root,
    tab,
    selected,
    selectedRunId,
    page,
    actionsPage,
    filePreviewOpen,
    sessionPreview.kind,
    setSessionPreview
  ])

  useEffect(() => {
    if (previewHost || !visible || !root || selected == null) {
      setDetail(null)
      setDetailError(null)
      setDetailLoading(false)
      return
    }
    if (!window.vav?.github?.getPull) {
      setDetail(null)
      setDetailError(t('github.apiMissing'))
      return
    }
    let cancelled = false
    setDetail(null)
    setDetailLoading(true)
    setDetailError(null)
    void (async () => {
      try {
        const result = await window.vav.github.getPull(root, selected)
        if (cancelled) return
        if (!result.ok) {
          setDetail(null)
          setDetailError(result.error)
          return
        }
        setDetail(result.data)
      } catch (err) {
        if (cancelled) return
        setDetail(null)
        setDetailError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setDetailLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [previewHost, visible, root, selected, t])

  useEffect(() => {
    if (previewHost || !visible || !root || tab !== 'actions' || selectedRunId == null) {
      setRunDetail(null)
      setRunDetailError(null)
      setRunDetailLoading(false)
      return
    }
    if (!window.vav?.github?.getActionRun) {
      setRunDetail(null)
      setRunDetailError(t('github.apiMissing'))
      return
    }
    let cancelled = false
    setRunDetail(null)
    setRunDetailLoading(true)
    setRunDetailError(null)
    void (async () => {
      try {
        const result = await window.vav.github.getActionRun(root, selectedRunId)
        if (cancelled) return
        if (!result.ok) {
          setRunDetail(null)
          setRunDetailError(result.error)
          return
        }
        setRunDetail(result.data)
      } catch (err) {
        if (cancelled) return
        setRunDetail(null)
        setRunDetailError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setRunDetailLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [previewHost, visible, root, tab, selectedRunId, t])

  const pulls = page?.pulls ?? []
  const runs = actionsPage?.runs ?? []

  useEffect(() => {
    if (selected == null) return
    const idx = pulls.findIndex((p) => p.number === selected)
    if (idx >= 0) setFocusIndex(idx)
  }, [selected, pulls])

  useEffect(() => {
    if (selectedRunId == null) return
    const idx = runs.findIndex((run) => run.id === selectedRunId)
    if (idx >= 0) setActionFocusIndex(idx)
  }, [selectedRunId, runs])

  const previewPull = (pull: GithubPullListItem): void => {
    if (!root) return
    setSelected(pull.number)
    setSessionPreview({ kind: 'github', cwd: root, pull })
    setFilePreviewOpen(true)
  }

  const previewRun = (run: GithubActionRun): void => {
    if (!root) return
    setSelectedRunId(run.id)
    setSessionPreview({ kind: 'github-action', cwd: root, run })
    setFilePreviewOpen(true)
  }

  const previewSite = (): void => {
    if (!root || !site) return
    setSessionPreview({ kind: 'github-site', cwd: root, site })
    setFilePreviewOpen(true)
  }

  const showPullMenu = (pull: GithubPullListItem, x: number, y: number): void => {
    const items: MenuItem[] = [
      { label: t('common.preview'), onSelect: () => previewPull(pull) },
      {
        label: t('github.openOnGithub'),
        onSelect: () => window.open(pull.url, '_blank', 'noopener,noreferrer')
      }
    ]
    void showMenu(items, { x, y })
  }

  const showRunMenu = (run: GithubActionRun, x: number, y: number): void => {
    const items: MenuItem[] = [
      { label: t('common.preview'), onSelect: () => previewRun(run) },
      {
        label: t('github.openOnGithub'),
        onSelect: () => window.open(run.htmlUrl, '_blank', 'noopener,noreferrer')
      }
    ]
    void showMenu(items, { x, y })
  }

  const onListKeyDown = makeListKeyDown({
    count: pulls.length,
    setIndex: setFocusIndex,
    selectAt: (index) => {
      const row = pulls[index]
      if (row) setSelected(row.number)
    },
    previewAt: (index) => {
      const row = pulls[index]
      if (row) previewPull(row)
    },
    scrollParent: listRef,
    rowAttr: 'data-github-row'
  })

  const onActionListKeyDown = makeListKeyDown({
    count: runs.length,
    setIndex: setActionFocusIndex,
    selectAt: (index) => {
      const row = runs[index]
      if (row) setSelectedRunId(row.id)
    },
    previewAt: (index) => {
      const row = runs[index]
      if (row) previewRun(row)
    },
    scrollParent: actionListRef,
    rowAttr: 'data-github-run-row'
  })

  if (!root) {
    return (
      <div className="github-panel">
        <EmptyState title={t('github.needProject')} description={t('github.needProjectDesc')} />
      </div>
    )
  }

  const selectedItem = pulls.find((p) => p.number === selected) ?? null
  const shown = detail && detail.number === selected ? detail : selectedItem
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? null
  const shownRun = runDetail && runDetail.id === selectedRunId ? runDetail : selectedRun

  return (
    <div className="github-panel">
      <div className="github-filter">
        <Segmented<GithubTrayTab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'pulls', label: t('github.tabOpenPr') },
            { value: 'actions', label: t('github.tabActions') },
            { value: 'site', label: t('github.tabSite') }
          ]}
        />
      </div>
      {tab === 'site' ? (
        <SitePane
          site={site}
          loading={siteLoading}
          error={siteError}
          code={siteCode}
          onPreview={previewSite}
        />
      ) : tab === 'actions' ? (
        <div className={`github-panel-body${previewHost ? ' is-list-only' : ''}`}>
          <div className="github-list-pane">
            <ActionsList
              runs={runs}
              selectedId={selectedRunId}
              focusIndex={actionFocusIndex}
              loading={actionsLoading}
              error={actionsError}
              code={actionsCode}
              loaded={Boolean(actionsPage)}
              listRef={actionListRef}
              onKeyDown={onActionListKeyDown}
              onSelect={(index, id) => {
                setActionFocusIndex(index)
                setSelectedRunId(id)
              }}
              onPreview={previewRun}
              onMenu={showRunMenu}
            />
          </div>
          {!previewHost ? (
            <div className="github-detail-pane">
              {!shownRun ? (
                runs.length > 0 ? (
                  <div className="github-detail-empty">{t('github.selectAction')}</div>
                ) : null
              ) : (
                <ActionDetail
                  run={shownRun}
                  detail={runDetail && runDetail.id === selectedRunId ? runDetail : null}
                  loading={runDetailLoading}
                  error={runDetailError}
                />
              )}
            </div>
          ) : null}
        </div>
      ) : (
        <div className={`github-panel-body${previewHost ? ' is-list-only' : ''}`}>
          <div className="github-list-pane">
            {loadError && !page ? (
              <EmptyState {...emptyForCode(loadCode, loadError, t)} />
            ) : !page ? (
              <EmptyState
                title={loading ? t('common.loading') : t('github.loadFailed')}
                description={loading ? undefined : t('github.apiMissing')}
              />
            ) : pulls.length === 0 ? (
              <EmptyState title={t('github.noPulls')} description={t('github.noPullsDesc')} />
            ) : (
              <div
                ref={listRef}
                className="github-pr-list"
                role="listbox"
                tabIndex={0}
                aria-label={t('github.pulls')}
                onKeyDown={onListKeyDown}
              >
                {pulls.map((pull, index) => {
                  const selectedRow = selected === pull.number
                  const focused = index === focusIndex
                  const updated = Date.parse(pull.updatedAt)
                  return (
                    <button
                      key={pull.number}
                      type="button"
                      role="option"
                      aria-selected={selectedRow}
                      data-github-row={index}
                      className={`github-pr-row${selectedRow ? ' is-selected' : ''}${
                        focused ? ' is-focused' : ''
                      }`}
                      onClick={() => {
                        setFocusIndex(index)
                        setSelected(pull.number)
                      }}
                      onDoubleClick={() => previewPull(pull)}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        setFocusIndex(index)
                        setSelected(pull.number)
                        showPullMenu(pull, event.clientX, event.clientY)
                      }}
                    >
                      <span
                        className={`github-pr-state ${stateClass(pull.state, pull.draft)}`}
                        aria-hidden
                      >
                        <PullStateIcon state={pull.state} draft={pull.draft} />
                      </span>
                      <span className="github-pr-num">#{pull.number}</span>
                      <span className="github-pr-title" title={pull.title}>
                        {pull.title}
                      </span>
                      <span className="github-pr-age">
                        {Number.isFinite(updated) ? relativeTime(updated) : ''}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          {!previewHost ? (
            <div className="github-detail-pane">
              {!shown ? (
                pulls.length > 0 ? (
                  <div className="github-detail-empty">{t('github.selectPull')}</div>
                ) : null
              ) : (
                <PullDetail
                  item={shown}
                  detail={detail && detail.number === selected ? detail : null}
                  loading={detailLoading}
                  error={detailError}
                />
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

function makeListKeyDown({
  count,
  setIndex,
  selectAt,
  previewAt,
  scrollParent,
  rowAttr
}: {
  count: number
  setIndex: (updater: (prev: number) => number) => void
  selectAt: (index: number) => void
  previewAt?: (index: number) => void
  scrollParent: React.RefObject<HTMLDivElement | null>
  rowAttr: string
}): (event: ReactKeyboardEvent<HTMLDivElement>) => void {
  const reveal = (index: number): void => {
    requestAnimationFrame(() => {
      scrollParent.current
        ?.querySelector(`[${rowAttr}="${index}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    })
  }
  return (event) => {
    if (count === 0) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setIndex((prev) => {
        const next = Math.max(0, Math.min(count - 1, prev + (event.key === 'ArrowDown' ? 1 : -1)))
        selectAt(next)
        reveal(next)
        return next
      })
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const next = event.key === 'Home' ? 0 : count - 1
      setIndex(() => next)
      selectAt(next)
      reveal(next)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setIndex((prev) => {
        if (previewAt) previewAt(prev)
        else selectAt(prev)
        return prev
      })
    }
  }
}

function ActionsList({
  runs,
  selectedId,
  focusIndex,
  loading,
  error,
  code,
  loaded,
  listRef,
  onKeyDown,
  onSelect,
  onPreview,
  onMenu
}: {
  runs: GithubActionRun[]
  selectedId: number | null
  focusIndex: number
  loading: boolean
  error: string | null
  code: GithubErrorCode | undefined
  loaded: boolean
  listRef: React.RefObject<HTMLDivElement | null>
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void
  onSelect: (index: number, id: number) => void
  onPreview?: (run: GithubActionRun) => void
  onMenu?: (run: GithubActionRun, x: number, y: number) => void
}): React.JSX.Element {
  const t = useT()
  if (error && !loaded) {
    return <EmptyState {...emptyForCode(code, error, t)} />
  }
  if (!loaded) {
    return (
      <EmptyState
        title={loading ? t('common.loading') : t('github.loadFailedActions')}
        description={loading ? undefined : t('github.apiMissing')}
      />
    )
  }
  if (runs.length === 0) {
    return <EmptyState title={t('github.noActions')} description={t('github.noActionsDesc')} />
  }
  return (
    <div
      ref={listRef}
      className="github-pr-list"
      role="listbox"
      tabIndex={0}
      aria-label={t('github.actions')}
      onKeyDown={onKeyDown}
    >
      {runs.map((run, index) => {
        const selectedRow = selectedId === run.id
        const focused = index === focusIndex
        const updated = Date.parse(run.updatedAt || run.runStartedAt || '')
        return (
          <button
            key={run.id}
            type="button"
            role="option"
            aria-selected={selectedRow}
            data-github-run-row={index}
            className={`github-pr-row${selectedRow ? ' is-selected' : ''}${
              focused ? ' is-focused' : ''
            }`}
            onClick={() => onSelect(index, run.id)}
            onDoubleClick={() => onPreview?.(run)}
            onContextMenu={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onSelect(index, run.id)
              onMenu?.(run, event.clientX, event.clientY)
            }}
          >
            <span className={`github-pr-state ${actionStateClass(run.status)}`} aria-hidden>
              <ActionStatusIcon status={run.status} />
            </span>
            <span className="github-pr-title" title={run.title || run.name}>
              {run.title || run.name}
            </span>
            <span className="github-pr-age">
              {Number.isFinite(updated) ? relativeTime(updated) : ''}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function ActionDetail({
  run,
  detail,
  loading,
  error,
  showOpen = true
}: {
  run: GithubActionRun
  detail: GithubActionRunDetail | null
  loading: boolean
  error: string | null
  showOpen?: boolean
}): React.JSX.Element {
  const t = useT()
  const jobs = detail?.jobs ?? []
  const started = Date.parse(run.runStartedAt || run.createdAt)
  return (
    <div className="github-detail-scroll">
      <div className="github-detail-hero">
        <div className="github-detail-title-row">
          <span className={`github-pr-state ${actionStateClass(run.status)}`} aria-hidden>
            <ActionStatusIcon status={run.status} size={13} />
          </span>
          <h2 className="github-detail-heading" title={run.title || run.name}>
            {run.title || run.name}
          </h2>
          {showOpen ? (
            <Button
              icon={<SafariIcon size={14} />}
              size="sm"
              className="github-open-web"
              title={t('github.openOnGithub')}
              onClick={() => window.open(run.htmlUrl, '_blank', 'noopener,noreferrer')}
            />
          ) : null}
        </div>
        <div className="github-detail-status-row">
          <span className={`github-detail-state ${actionStateClass(run.status)}`}>
            {actionStatusLabel(run.status, t)}
          </span>
          <p className="github-merge-prose">
            {run.name ? <span>{run.name}</span> : null}
            {run.headBranch ? (
              <>
                {' · '}
                <code>{run.headBranch}</code>
              </>
            ) : null}
            {run.event ? ` · ${run.event}` : ''}
            {run.actor.login ? ` · ${run.actor.login}` : ''}
            {Number.isFinite(started) ? ` · ${relativeTime(started)}` : ''}
          </p>
        </div>
      </div>
      <div className="github-detail-body">
        {loading && !detail ? (
          <GithubDetailLoading label={t('common.loading')} />
        ) : error ? (
          <div className="github-detail-error">{error}</div>
        ) : jobs.length === 0 ? (
          <div className="github-no-body">{t('github.noActionJobs')}</div>
        ) : (
          <div className="github-action-jobs">
            {jobs.map((job) => (
              <ActionJobRow key={job.id} job={job} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ActionJobRow({ job }: { job: GithubActionJob }): React.JSX.Element {
  const t = useT()
  return (
    <button
      type="button"
      className="github-action-job"
      onClick={() => {
        if (job.htmlUrl) window.open(job.htmlUrl, '_blank', 'noopener,noreferrer')
      }}
    >
      <span className={`github-pr-state ${actionStateClass(job.status)}`} aria-hidden>
        <ActionStatusIcon status={job.status} />
      </span>
      <span className="github-action-job-name">{job.name}</span>
      <span className="github-action-job-status">{actionStatusLabel(job.status, t)}</span>
    </button>
  )
}

function ActionStatusIcon({
  status,
  size = 12
}: {
  status: GithubActionStatus
  size?: number
}): React.JSX.Element {
  if (status === 'in_progress') return <LoaderCircle size={size} className="github-action-spin" />
  if (status === 'queued' || status === 'pending' || status === 'requested') {
    return <CircleDashed size={size} />
  }
  if (status === 'completed') return <Check size={size} />
  return <Play size={size} />
}

function actionStateClass(status: GithubActionStatus): string {
  if (status === 'in_progress') return 'is-open'
  if (status === 'completed') return 'is-merged'
  return 'is-draft'
}

function actionStatusLabel(
  status: GithubActionStatus,
  t: ReturnType<typeof useT>
): string {
  if (status === 'in_progress') return t('github.actionInProgress')
  if (status === 'queued') return t('github.actionQueued')
  if (status === 'waiting') return t('github.actionWaiting')
  if (status === 'pending' || status === 'requested') return t('github.actionPending')
  return t('github.actionCompleted')
}

function SitePane({
  site,
  loading,
  error,
  code,
  showOpen = true,
  onPreview
}: {
  site: GithubSite | null
  loading: boolean
  error: string | null
  code: GithubErrorCode | undefined
  showOpen?: boolean
  onPreview?: () => void
}): React.JSX.Element {
  const t = useT()
  if (error && !site) {
    return <EmptyState {...emptyForCode(code, error, t)} />
  }
  if (!site) {
    return (
      <EmptyState
        title={loading ? t('common.loading') : t('github.loadFailedSite')}
        description={loading ? undefined : t('github.apiMissing')}
      />
    )
  }
  if (!isGithubPagesLive(site) && !site.homepage) {
    return (
      <EmptyState title={t('github.noSite')} description={t('github.noSiteDesc')}>
        <Button
          icon={<Settings size={14} />}
          size="sm"
          label={t('github.openPagesSettings')}
          onClick={() => window.open(site.settingsUrl, '_blank', 'noopener,noreferrer')}
        />
      </EmptyState>
    )
  }
  return (
    <div
      className="github-site-host"
      onDoubleClick={() => onPreview?.()}
      onContextMenu={(event) => {
        if (!onPreview) return
        event.preventDefault()
        const items: MenuItem[] = [{ label: tt('common.preview'), onSelect: onPreview }]
        void showMenu(items, { x: event.clientX, y: event.clientY })
      }}
    >
      <SiteConfig site={site} showOpen={showOpen} />
    </div>
  )
}

function SiteConfig({
  site,
  showOpen
}: {
  site: GithubSite
  showOpen: boolean
}): React.JSX.Element {
  const t = useT()
  const view = fillGithubSiteGaps(site)
  const live = isGithubPagesLive(view)
  const customDomain = githubPagesCustomDomain(view)
  const sourceLabel = view.buildType === 'workflow'
    ? t('github.siteSourceWorkflow')
    : view.buildType === 'legacy' || view.source
      ? t('github.siteSourceLegacy')
      : t('github.siteNone')
  const branchLabel = view.source
    ? `${view.source.branch} ${view.source.path === '/' ? t('github.siteRoot') : view.source.path}`
    : t('github.siteNone')
  const showHomepage = Boolean(
    view.homepage && !sameSiteHost(view.homepage, view.url, view.cname)
  )
  const deployedAt = view.latestBuild?.createdAt ? Date.parse(view.latestBuild.createdAt) : Number.NaN
  return (
    <div className="github-site">
      <div className="github-detail-scroll">
        <div className="github-detail-hero">
          <div className="github-detail-status-row">
            <span
              className={`github-detail-state ${pagesStatusClass(live ? view.pagesStatus ?? 'built' : null)}`}
            >
              {live ? pagesStatusLabel(view.pagesStatus ?? 'built', t) : t('github.noSite')}
            </span>
            {live && view.url ? (
              <p className="github-merge-prose">
                {t('github.siteLiveAt')}{' '}
                <button
                  type="button"
                  className="github-site-link"
                  onClick={() => window.open(view.url!, '_blank', 'noopener,noreferrer')}
                >
                  {view.url}
                </button>
              </p>
            ) : (
              <p className="github-merge-prose">{t('github.noSiteDesc')}</p>
            )}
            {live && view.url ? (
              <Button
                icon={<SafariIcon size={14} />}
                size="sm"
                className="github-open-web"
                title={t('github.openSite')}
                onClick={() => window.open(view.url!, '_blank', 'noopener,noreferrer')}
              />
            ) : null}
            {showOpen ? (
              <Button
                icon={<Settings size={14} />}
                size="sm"
                className="github-open-web"
                title={t('github.openPagesSettings')}
                onClick={() => window.open(view.settingsUrl, '_blank', 'noopener,noreferrer')}
              />
            ) : null}
          </div>
          {live && view.latestBuild ? (
            <p className="github-merge-prose">
              {t('github.siteLastDeployed', {
                user: view.latestBuild.pusher || t('github.authorUnknown')
              })}
              {Number.isFinite(deployedAt) ? ` · ${relativeTime(deployedAt)}` : ''}
            </p>
          ) : null}
        </div>
        <div className="github-detail-body">
          {live ? (
            <div className="github-site-fields-wrap">
              <SiteField label={t('github.siteSource')}>{sourceLabel}</SiteField>
              <SiteField label={t('github.siteBranch')}>{branchLabel}</SiteField>
              <SiteField label={t('github.siteCustomDomain')}>
                {customDomain || t('github.siteNone')}
              </SiteField>
              <SiteField label={t('github.siteHttps')}>
                {view.httpsEnforced == null
                  ? t('github.siteNone')
                  : view.httpsEnforced
                    ? t('github.siteHttpsOn')
                    : t('github.siteHttpsOff')}
              </SiteField>
              {view.protectedDomainState ? (
                <SiteField label={t('github.siteDomainState')}>
                  {domainStateLabel(view.protectedDomainState, t)}
                </SiteField>
              ) : null}
              {view.public != null ? (
                <SiteField label={t('github.siteVisibility')}>
                  {view.public ? t('github.sitePublic') : t('github.sitePrivate')}
                </SiteField>
              ) : null}
            </div>
          ) : (
            <div className="github-no-body">{t('github.noSiteDesc')}</div>
          )}
          {showHomepage ? (
            <SiteSection title={t('github.siteAbout')}>
              <SiteField label={t('github.siteHomepage')}>
                <button
                  type="button"
                  className="github-site-link"
                  onClick={() => window.open(view.homepage!, '_blank', 'noopener,noreferrer')}
                >
                  {view.homepage}
                </button>
              </SiteField>
            </SiteSection>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function sameSiteHost(
  homepage: string | null,
  url: string | null,
  cname: string | null
): boolean {
  const host = (value: string | null): string | null => {
    if (!value) return null
    try {
      const raw = /^https?:\/\//i.test(value) ? value : `https://${value}`
      return new URL(raw).hostname.replace(/^www\./, '').toLowerCase()
    } catch {
      return value.replace(/^www\./, '').toLowerCase()
    }
  }
  const home = host(homepage)
  if (!home) return false
  return home === host(url) || home === host(cname)
}

function SiteSection({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="github-site-section">
      <h3 className="github-site-section-title">{title}</h3>
      <dl className="github-site-fields">{children}</dl>
    </section>
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

function pagesStatusLabel(status: string | null, t: ReturnType<typeof useT>): string {
  if (status === 'built') return t('github.siteStatusBuilt')
  if (status === 'building') return t('github.siteStatusBuilding')
  if (status === 'errored') return t('github.siteStatusErrored')
  return status || t('github.siteNone')
}

function pagesStatusClass(status: string | null): string {
  if (status === 'built') return 'is-merged'
  if (status === 'building') return 'is-open'
  if (status === 'errored') return 'is-closed'
  return 'is-draft'
}

function domainStateLabel(state: string | null, t: ReturnType<typeof useT>): string {
  if (state === 'verified') return t('github.siteDomainVerified')
  if (state === 'pending') return t('github.siteDomainPending')
  if (state === 'unverified') return t('github.siteDomainUnverified')
  return state || t('github.siteNone')
}

function PullDetail({
  item,
  detail,
  loading,
  error,
  showOpen = true
}: {
  item: GithubPullListItem
  detail: GithubPullDetail | null
  loading: boolean
  error: string | null
  /** Tray split: open control in the title row. Preview chrome owns it. */
  showOpen?: boolean
}): React.JSX.Element {
  const t = useT()

  return (
    <div className="github-detail-scroll">
      <div className="github-detail-hero">
        <div className="github-detail-title-row">
          <span
            className={`github-pr-state ${stateClass(item.state, item.draft)}`}
            aria-hidden
          >
            <PullStateIcon state={item.state} draft={item.draft} size={13} />
          </span>
          <h2 className="github-detail-heading" title={item.title}>
            {item.title}
          </h2>
          <span className="github-detail-num">#{item.number}</span>
          {showOpen ? (
            <Button
              icon={<SafariIcon size={14} />}
              size="sm"
              className="github-open-web"
              title={t('github.openOnGithub')}
              onClick={() => window.open(item.url, '_blank', 'noopener,noreferrer')}
            />
          ) : null}
        </div>
        <div className="github-detail-status-row">
          <span className={`github-detail-state ${stateClass(item.state, item.draft)}`}>
            {item.state === 'merged'
              ? t('github.merged')
              : item.state === 'closed'
                ? t('github.closed')
                : item.draft
                  ? t('github.draft')
                  : t('github.open')}
          </span>
          <MergeProse item={item} detail={detail} />
        </div>
        {(item.labels ?? []).length > 0 && (
          <div className="github-labels">
            {(item.labels ?? []).map((label) => (
              <span key={label.name} className="github-label">
                {label.name}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="github-detail-body">
        {loading && !detail ? (
          <GithubDetailLoading label={t('common.loading')} />
        ) : error ? (
          <div className="github-detail-error">{error}</div>
        ) : detail ? (
          <ConversationTab detail={detail} />
        ) : null}
      </div>
    </div>
  )
}

function MergeProse({
  item,
  detail
}: {
  item: GithubPullListItem
  detail: GithubPullDetail | null
}): React.JSX.Element {
  const t = useT()
  const who =
    detail?.mergedBy?.login ||
    item.author.login ||
    t('github.authorUnknown')
  const n = detail?.commits || 0
  const when = Date.parse(detail?.mergedAt || item.updatedAt)
  const lead =
    item.state === 'merged'
      ? t('github.mergedBy', { user: who, n })
      : t('github.wantsToMerge', { user: who, n })
  return (
    <p className="github-merge-prose">
      {lead}{' '}
      <code>{item.baseRef || 'main'}</code>
      {' '}
      {t('github.fromBranch')}{' '}
      <code>{item.headRef || '?'}</code>
      {Number.isFinite(when) ? ` · ${relativeTime(when)}` : ''}
    </p>
  )
}

function GithubDetailLoading({ label }: { label: string }): React.JSX.Element {
  return (
    <div className="github-detail-loading" aria-busy="true" aria-live="polite">
      <LoaderCircle size={14} className="github-action-spin" aria-hidden />
      <span>{label}</span>
    </div>
  )
}

function ConversationTab({ detail }: { detail: GithubPullDetail }): React.JSX.Element {
  const t = useT()
  const body = detail.body?.trim() ?? ''
  const comments = detail.comments ?? []
  const reviews = detail.reviews ?? []
  const reviewComments = detail.reviewComments ?? []
  const reviewers = detail.reviewers ?? []
  const assignees = detail.assignees ?? []
  const timeline = mergePullConversation(comments, reviews, reviewComments)
  const latestReviews = latestReviewByUser(reviews)
  return (
    <div className="github-conversation">
      {(latestReviews.length > 0 || reviewers.length > 0 || assignees.length > 0) && (
        <div className="github-people">
          {latestReviews.length > 0 && (
            <div className="github-review-summary">
              {latestReviews.map((review) => (
                <span
                  key={review.author.login || review.id}
                  className={`github-review-chip is-${review.state}`}
                >
                  <ReviewStateIcon state={review.state} />
                  {review.author.login || t('github.authorUnknown')}
                </span>
              ))}
            </div>
          )}
          {reviewers.length > 0 && (
            <div className="github-reviewers">
              <span className="github-reviewers-label">{t('github.reviewers')}</span>
              {reviewers.map((user) => (
                <span key={user.login} className="github-reviewer">
                  {user.avatarUrl ? (
                    <img className="github-avatar" src={user.avatarUrl} alt="" />
                  ) : null}
                  {user.login}
                </span>
              ))}
            </div>
          )}
          {assignees.length > 0 && (
            <div className="github-reviewers">
              <span className="github-reviewers-label">{t('github.assignees')}</span>
              {assignees.map((user) => (
                <span key={user.login} className="github-reviewer">
                  {user.avatarUrl ? (
                    <img className="github-avatar" src={user.avatarUrl} alt="" />
                  ) : null}
                  {user.login}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="github-thread-item github-op">
        <div className="github-thread-head">
          {detail.author?.avatarUrl ? (
            <img className="github-avatar" src={detail.author.avatarUrl} alt="" />
          ) : null}
          <span className="github-author">{detail.author?.login || t('github.authorUnknown')}</span>
          <span className="github-detail-time">
            {Number.isFinite(Date.parse(detail.createdAt))
              ? relativeTime(Date.parse(detail.createdAt))
              : ''}
          </span>
        </div>
        {body ? (
          <div className="github-pr-body">
            <GithubMarkdown source={body} />
          </div>
        ) : (
          <div className="github-no-body">{t('github.noBody')}</div>
        )}
      </div>
      {timeline.length === 0 ? (
        <div className="github-no-body">{t('github.noConversation')}</div>
      ) : (
        timeline.map((item) =>
          item.kind === 'review' ? (
            <ThreadReview key={`r-${item.review.id}`} review={item.review} comments={item.comments} />
          ) : (
            <ThreadComment
              key={`${item.kind}-${item.comment.id}`}
              comment={item.comment}
              showLine={item.kind === 'inline'}
            />
          )
        )
      )}
    </div>
  )
}

function latestReviewByUser(reviews: GithubReview[]): GithubReview[] {
  const map = new Map<string, GithubReview>()
  for (const review of reviews) {
    if (review.state === 'commented' && !review.body) continue
    const key = review.author.login || String(review.id)
    map.set(key, review)
  }
  return [...map.values()]
}

function ReviewStateIcon({ state }: { state: GithubReviewState }): React.JSX.Element {
  if (state === 'approved') return <Check size={11} />
  if (state === 'changes_requested') return <X size={11} />
  return <MessageSquare size={11} />
}

function reviewStateLabel(
  state: GithubReviewState,
  t: ReturnType<typeof useT>
): string {
  if (state === 'approved') return t('github.approved')
  if (state === 'changes_requested') return t('github.changesRequested')
  if (state === 'dismissed') return t('github.dismissed')
  return t('github.commented')
}

function ThreadComment({
  comment,
  showLine,
  nested
}: {
  comment: GithubComment
  showLine?: boolean
  nested?: boolean
}): React.JSX.Element {
  const t = useT()
  const at = Date.parse(comment.createdAt)
  const author = comment.author
  const body = (comment.body ?? '').trim()
  return (
    <div className={nested ? 'github-thread-item github-thread-nested' : 'github-thread-item'}>
      <div className="github-thread-head">
        {author?.avatarUrl ? (
          <img className="github-avatar" src={author.avatarUrl} alt="" />
        ) : null}
        <span className="github-author">{author?.login || t('github.authorUnknown')}</span>
        {showLine && comment.line != null ? (
          <span className="github-thread-line">L{comment.line}</span>
        ) : null}
        {nested && comment.path ? (
          <span className="github-thread-path" title={comment.path}>
            {comment.path}
          </span>
        ) : null}
        {Number.isFinite(at) ? (
          <span className="github-detail-time">{relativeTime(at)}</span>
        ) : null}
      </div>
      {body ? (
        <div className="github-pr-body github-thread-body">
          <GithubMarkdown source={comment.body} />
        </div>
      ) : null}
    </div>
  )
}

function ThreadReview({
  review,
  comments
}: {
  review: GithubReview
  comments: GithubComment[]
}): React.JSX.Element {
  const t = useT()
  const at = Date.parse(review.submittedAt ?? '')
  const author = review.author
  return (
    <div className="github-thread-item">
      <div className="github-thread-head">
        {author?.avatarUrl ? (
          <img className="github-avatar" src={author.avatarUrl} alt="" />
        ) : null}
        <span className="github-author">{author?.login || t('github.authorUnknown')}</span>
        <span className={`github-review-chip is-${review.state}`}>
          <ReviewStateIcon state={review.state} />
          {reviewStateLabel(review.state, t)}
        </span>
        {Number.isFinite(at) ? (
          <span className="github-detail-time">{relativeTime(at)}</span>
        ) : null}
      </div>
      {review.body ? (
        <div className="github-pr-body github-thread-body">
          <GithubMarkdown source={review.body} />
        </div>
      ) : null}
      {comments.map((comment) => (
        <ThreadComment key={comment.id} comment={comment} showLine nested />
      ))}
    </div>
  )
}

function GithubMarkdown({ source }: { source: string }): React.JSX.Element {
  const html = useMemo(() => {
    try {
      return renderGithubMarkdown(source)
    } catch {
      return ''
    }
  }, [source])
  return (
    <div className="markdown preview-markdown" dangerouslySetInnerHTML={{ __html: html }} />
  )
}
