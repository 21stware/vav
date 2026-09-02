import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { emptyForCode } from '../lib/githubPanelCopy'
import {
  ActionsList,
  ListGroupHead,
  makeListKeyDown,
  PullRow,
  ReleasesList
} from './githubPanel/GithubList'
import { ActionDetail, PullDetail, ReleaseDetail, SitePane } from './githubPanel/GithubDetail'
import type {
  GithubActionRun,
  GithubActionRunDetail,
  GithubActionsPage,
  GithubErrorCode,
  GithubPullDetail,
  GithubPullListItem,
  GithubPullsPage,
  GithubRelease,
  GithubReleasesPage,
  GithubSite,
  GithubTrayTab
} from '@shared/github'
import {
  githubClosedPullsUrl,
  githubRepoSectionUrl,
  isGithubPagesLive
} from '@shared/github'
import { useSessionStore } from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { useT, tt } from '../i18n/useT'
import { EmptyState, Segmented } from './ui'
import { showMenu, type MenuItem } from '../lib/nativeMenu'

export type GithubPanelChrome = {
  meta: string | null
  loading: boolean
  refresh: () => void
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

  const [closedPage, setClosedPage] = useState<GithubPullsPage | null>(null)
  const [closedOpen, setClosedOpen] = useState(false)
  const [closedLoading, setClosedLoading] = useState(false)
  const [closedError, setClosedError] = useState<string | null>(null)

  const [historyPage, setHistoryPage] = useState<GithubActionsPage | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)

  const [releasesPage, setReleasesPage] = useState<GithubReleasesPage | null>(null)
  const [releasesError, setReleasesError] = useState<string | null>(null)
  const [releasesCode, setReleasesCode] = useState<GithubErrorCode | undefined>(undefined)
  const [releasesLoading, setReleasesLoading] = useState(false)
  const [selectedReleaseId, setSelectedReleaseId] = useState<number | null>(null)
  const [releaseFocusIndex, setReleaseFocusIndex] = useState(0)
  const releaseListRef = useRef<HTMLDivElement>(null)

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

  const loadClosedPulls = useCallback(async (): Promise<void> => {
    if (!root || !window.vav?.github?.listPulls) return
    setClosedLoading(true)
    setClosedError(null)
    try {
      const result = await window.vav.github.listPulls(root, 'closed')
      if (!result.ok) {
        setClosedPage(null)
        setClosedError(result.error)
        return
      }
      setClosedPage(result.data)
    } catch (err) {
      setClosedPage(null)
      setClosedError(err instanceof Error ? err.message : String(err))
    } finally {
      setClosedLoading(false)
    }
  }, [root])

  const loadActionHistory = useCallback(async (): Promise<void> => {
    if (!root || !window.vav?.github?.listActions) return
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const result = await window.vav.github.listActions(root, 'history')
      if (!result.ok) {
        setHistoryPage(null)
        setHistoryError(result.error)
        return
      }
      setHistoryPage(result.data)
    } catch (err) {
      setHistoryPage(null)
      setHistoryError(err instanceof Error ? err.message : String(err))
    } finally {
      setHistoryLoading(false)
    }
  }, [root])

  const refreshReleases = useCallback(async (): Promise<void> => {
    if (!root) {
      setReleasesPage(null)
      setSelectedReleaseId(null)
      setReleasesError(null)
      setReleasesCode(undefined)
      return
    }
    if (!window.vav?.github?.listReleases) {
      setReleasesPage(null)
      setReleasesError(tt('github.apiMissing'))
      setReleasesCode(undefined)
      return
    }
    setReleasesLoading(true)
    setReleasesError(null)
    setReleasesCode(undefined)
    try {
      const result = await window.vav.github.listReleases(root)
      if (!result.ok) {
        setReleasesPage(null)
        setSelectedReleaseId(null)
        setReleasesError(result.error)
        setReleasesCode(result.code)
        return
      }
      setReleasesPage(result.data)
      setSelectedReleaseId((prev) => {
        if (prev && result.data.releases.some((row) => row.id === prev)) return prev
        return null
      })
    } catch (err) {
      setReleasesPage(null)
      setReleasesError(err instanceof Error ? err.message : String(err))
      setReleasesCode('network')
    } finally {
      setReleasesLoading(false)
    }
  }, [root])

  const toggleClosedPulls = useCallback((): void => {
    setClosedOpen((open) => {
      const next = !open
      if (next && !closedPage && !closedLoading) void loadClosedPulls()
      return next
    })
  }, [closedPage, closedLoading, loadClosedPulls])

  const toggleActionHistory = useCallback((): void => {
    setHistoryOpen((open) => {
      const next = !open
      if (next && !historyPage && !historyLoading) void loadActionHistory()
      return next
    })
  }, [historyPage, historyLoading, loadActionHistory])

  const refresh = useCallback(async (): Promise<void> => {
    if (tab === 'actions') {
      await refreshActions()
      if (historyOpen) await loadActionHistory()
      return
    }
    if (tab === 'site') return refreshSite()
    if (tab === 'releases') return refreshReleases()
    await refreshPulls()
    if (closedOpen) await loadClosedPulls()
  }, [
    tab,
    historyOpen,
    closedOpen,
    refreshActions,
    refreshSite,
    refreshReleases,
    refreshPulls,
    loadActionHistory,
    loadClosedPulls
  ])

  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  const stableRefresh = useCallback(() => {
    void refreshRef.current()
  }, [])

  useEffect(() => {
    setClosedPage(null)
    setClosedOpen(false)
    setClosedError(null)
    setClosedLoading(false)
    setHistoryPage(null)
    setHistoryOpen(false)
    setHistoryError(null)
    setHistoryLoading(false)
    setReleasesPage(null)
    setSelectedReleaseId(null)
    setReleaseFocusIndex(0)
  }, [root])

  useEffect(() => {
    if (!visible) return
    void refresh()
  }, [visible, refresh])

  const chromeLoading =
    tab === 'actions'
      ? actionsLoading
      : tab === 'site'
        ? siteLoading
        : tab === 'releases'
          ? releasesLoading
          : loading
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
    if (tab === 'releases') {
      if (!releasesPage) return null
      return `${releasesPage.repo.fullName} · ${t('github.releaseCount', { n: releasesPage.releases.length })}`
    }
    if (!page) return null
    return `${page.repo.fullName} · ${
      page.truncated
        ? t('github.pullCountTruncated', { n: page.pulls.length })
        : t('github.pullCount', { n: page.pulls.length })
    }`
  }, [tab, actionsPage, site, releasesPage, page, t])

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
      const run =
        (actionsPage?.runs ?? []).find((item) => item.id === selectedRunId) ??
        (historyPage?.runs ?? []).find((item) => item.id === selectedRunId)
      if (!run) return
      setSessionPreview({ kind: 'github-action', cwd: root, run })
      return
    }
    if (tab === 'site') return
    if (tab === 'releases') {
      if (sessionPreview.kind !== 'github-release') return
      const release = (releasesPage?.releases ?? []).find((item) => item.id === selectedReleaseId)
      if (!release) return
      setSessionPreview({ kind: 'github-release', cwd: root, release })
      return
    }
    if (sessionPreview.kind !== 'github') return
    if (selected == null) return
    const pull =
      (page?.pulls ?? []).find((item) => item.number === selected) ??
      (closedPage?.pulls ?? []).find((item) => item.number === selected)
    if (!pull) return
    setSessionPreview({ kind: 'github', cwd: root, pull })
  }, [
    visible,
    previewHost,
    root,
    tab,
    selected,
    selectedRunId,
    selectedReleaseId,
    page,
    closedPage,
    actionsPage,
    historyPage,
    releasesPage,
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
  const closedPulls = closedPage?.pulls ?? []
  const runs = actionsPage?.runs ?? []
  const historyRuns = historyPage?.runs ?? []
  const releases = releasesPage?.releases ?? []
  const allRuns = useMemo(() => {
    const seen = new Set<number>()
    const out: GithubActionRun[] = []
    for (const run of [...runs, ...historyRuns]) {
      if (seen.has(run.id)) continue
      seen.add(run.id)
      out.push(run)
    }
    return out
  }, [runs, historyRuns])

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

  useEffect(() => {
    if (selectedReleaseId == null) return
    const idx = releases.findIndex((row) => row.id === selectedReleaseId)
    if (idx >= 0) setReleaseFocusIndex(idx)
  }, [selectedReleaseId, releases])

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

  const previewRelease = (release: GithubRelease): void => {
    if (!root) return
    setSelectedReleaseId(release.id)
    setSessionPreview({ kind: 'github-release', cwd: root, release })
    setFilePreviewOpen(true)
  }

  const openUrl = (url: string): void => {
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const showPullMenu = (pull: GithubPullListItem, x: number, y: number): void => {
    const items: MenuItem[] = [
      { label: t('common.preview'), onSelect: () => previewPull(pull) },
      {
        label: t('github.openOnGithub'),
        onSelect: () => openUrl(pull.url)
      }
    ]
    void showMenu(items, { x, y })
  }

  const showRunMenu = (run: GithubActionRun, x: number, y: number): void => {
    const items: MenuItem[] = [
      { label: t('common.preview'), onSelect: () => previewRun(run) },
      {
        label: t('github.openOnGithub'),
        onSelect: () => openUrl(run.htmlUrl)
      }
    ]
    void showMenu(items, { x, y })
  }

  const showReleaseMenu = (release: GithubRelease, x: number, y: number): void => {
    const items: MenuItem[] = [
      { label: t('common.preview'), onSelect: () => previewRelease(release) },
      { label: t('github.openOnGithub'), onSelect: () => openUrl(release.htmlUrl) }
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

  const onReleaseListKeyDown = makeListKeyDown({
    count: releases.length,
    setIndex: setReleaseFocusIndex,
    selectAt: (index) => {
      const row = releases[index]
      if (row) setSelectedReleaseId(row.id)
    },
    previewAt: (index) => {
      const row = releases[index]
      if (row) previewRelease(row)
    },
    scrollParent: releaseListRef,
    rowAttr: 'data-github-release-row'
  })

  if (!root) {
    return (
      <div className="github-panel">
        <EmptyState title={t('github.needProject')} description={t('github.needProjectDesc')} />
      </div>
    )
  }

  const selectedItem =
    pulls.find((p) => p.number === selected) ??
    closedPulls.find((p) => p.number === selected) ??
    null
  const shown = detail && detail.number === selected ? detail : selectedItem
  const selectedRun = allRuns.find((run) => run.id === selectedRunId) ?? null
  const shownRun = runDetail && runDetail.id === selectedRunId ? runDetail : selectedRun
  const selectedRelease = releases.find((row) => row.id === selectedReleaseId) ?? null
  const repoRef = page?.repo ?? actionsPage?.repo ?? releasesPage?.repo ?? site?.repo ?? null

  return (
    <div className="github-panel">
      <div className="github-filter">
        <Segmented<GithubTrayTab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'pulls', label: t('github.tabOpenPr'), title: t('github.tabOpenPr') },
            { value: 'actions', label: t('github.tabActions'), title: t('github.tabActions') },
            { value: 'releases', label: t('github.tabReleases'), title: t('github.tabReleases') },
            { value: 'site', label: t('github.tabSite'), title: t('github.tabSite') }
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
              history={historyRuns}
              historyOpen={historyOpen}
              historyLoading={historyLoading}
              historyError={historyError}
              selectedId={selectedRunId}
              focusIndex={actionFocusIndex}
              loading={actionsLoading}
              error={actionsError}
              code={actionsCode}
              loaded={Boolean(actionsPage)}
              repo={actionsPage?.repo ?? repoRef}
              listRef={actionListRef}
              onKeyDown={onActionListKeyDown}
              onToggleHistory={toggleActionHistory}
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
                runs.length > 0 || historyRuns.length > 0 ? (
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
      ) : tab === 'releases' ? (
        <div className={`github-panel-body${previewHost ? ' is-list-only' : ''}`}>
          <div className="github-list-pane">
            <ReleasesList
              releases={releases}
              selectedId={selectedReleaseId}
              focusIndex={releaseFocusIndex}
              loading={releasesLoading}
              error={releasesError}
              code={releasesCode}
              loaded={Boolean(releasesPage)}
              listRef={releaseListRef}
              onKeyDown={onReleaseListKeyDown}
              onSelect={(index, id) => {
                setReleaseFocusIndex(index)
                setSelectedReleaseId(id)
              }}
              onPreview={previewRelease}
              onMenu={showReleaseMenu}
              onOpenWeb={
                repoRef ? () => openUrl(githubRepoSectionUrl(repoRef, 'releases')) : undefined
              }
            />
          </div>
          {!previewHost ? (
            <div className="github-detail-pane">
              {!selectedRelease ? (
                releases.length > 0 ? (
                  <div className="github-detail-empty">{t('github.selectRelease')}</div>
                ) : null
              ) : (
                <ReleaseDetail release={selectedRelease} />
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
            ) : (
              <div
                ref={listRef}
                className="github-pr-list"
                role="listbox"
                tabIndex={0}
                aria-label={t('github.pulls')}
                onKeyDown={onListKeyDown}
              >
                {pulls.length === 0 ? (
                  <div className="github-group-empty">{t('github.noPulls')}</div>
                ) : (
                  pulls.map((pull, index) => (
                    <PullRow
                      key={pull.number}
                      pull={pull}
                      index={index}
                      selected={selected === pull.number}
                      focused={index === focusIndex}
                      onSelect={() => {
                        setFocusIndex(index)
                        setSelected(pull.number)
                      }}
                      onPreview={() => previewPull(pull)}
                      onMenu={(x, y) => showPullMenu(pull, x, y)}
                    />
                  ))
                )}
                {repoRef ? (
                  <ListGroupHead
                    label={t('github.closedPulls')}
                    expanded={closedOpen}
                    loading={closedLoading}
                    onToggle={toggleClosedPulls}
                    onOpenWeb={() => openUrl(githubClosedPullsUrl(repoRef))}
                    openWebLabel={t('github.openClosedOnGithub')}
                  />
                ) : null}
                {closedOpen ? (
                  closedError && !closedPage ? (
                    <div className="github-group-empty">{closedError}</div>
                  ) : closedLoading && !closedPage ? (
                    <div className="github-group-empty">{t('common.loading')}</div>
                  ) : closedPulls.length === 0 ? (
                    <div className="github-group-empty">{t('github.closedPullsEmpty')}</div>
                  ) : (
                    closedPulls.map((pull) => (
                      <PullRow
                        key={`c-${pull.number}`}
                        pull={pull}
                        selected={selected === pull.number}
                        onSelect={() => setSelected(pull.number)}
                        onPreview={() => previewPull(pull)}
                        onMenu={(x, y) => showPullMenu(pull, x, y)}
                      />
                    ))
                  )
                ) : null}
              </div>
            )}
          </div>
          {!previewHost ? (
            <div className="github-detail-pane">
              {!shown ? (
                pulls.length > 0 || closedPulls.length > 0 ? (
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
