import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import { ChevronDown, ChevronRight, X } from 'lucide-react'
import type { GitChangeEntry, GitSnapshot } from '@shared/git'
import { useSessionStore } from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { useT, tt } from '../i18n/useT'
import { isTemporaryWorkspace, workdirShortLabel } from '../lib/format'
import { bumpGitRepoSync, useGitRepoSyncEpoch } from '../lib/gitRepoSync'
import { fileManagerLabel } from '../lib/platform'
import { highlightCode, languageFromPath } from '../lib/highlightCode'
import { selectedBlockIdsForPath } from '../lib/applyBlockPick'
import { parseDiffBlocks } from '../lib/previewBlocks'
import { TextBlockPick } from './TextBlockPick'
import { SelectionChrome } from './SelectionChrome'
import { onHljsReady } from '../lib/hljsLazy'
import { dirname } from '../lib/path'
import { FileManagerIcon } from './FileManagerIcon'
import { EnableVersionControlChrome } from './SessionWorkspaceChrome'
import { Button, EmptyState } from './ui'
import { showMenu, type MenuItem } from '../lib/nativeMenu'

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|ico|bmp|avif)$/i

function statusLetter(entry: GitChangeEntry): string {
  if (entry.status === 'untracked') return 'U'
  if (entry.status === 'conflict') return '!'
  if (entry.status === 'added') return 'A'
  if (entry.status === 'deleted') return 'D'
  if (entry.status === 'renamed') return 'R'
  if (entry.status === 'modified') return 'M'
  return entry.code.trim().slice(-1) || '?'
}

function mimeForImagePath(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  if (lower.endsWith('.ico')) return 'image/x-icon'
  if (lower.endsWith('.bmp')) return 'image/bmp'
  if (lower.endsWith('.avif')) return 'image/avif'
  return 'application/octet-stream'
}

function isImagePath(path: string): boolean {
  return IMAGE_EXT.test(path)
}

function looksBinaryDiff(text: string): boolean {
  return /Binary files .* differ/i.test(text) || /GIT binary patch/i.test(text)
}

type DirNode = {
  kind: 'dir'
  name: string
  path: string
  children: TreeNode[]
}

type FileNode = {
  kind: 'file'
  name: string
  path: string
  entry: GitChangeEntry
}

type TreeNode = DirNode | FileNode

function buildChangeTree(changes: GitChangeEntry[]): TreeNode[] {
  type MutableDir = {
    kind: 'dir'
    name: string
    path: string
    dirs: Map<string, MutableDir>
    files: FileNode[]
  }

  const root: MutableDir = { kind: 'dir', name: '', path: '', dirs: new Map(), files: [] }

  const sorted = [...changes].sort((a, b) => a.path.localeCompare(b.path))
  for (const entry of sorted) {
    const parts = entry.path.split(/[/\\]/).filter(Boolean)
    if (parts.length === 0) continue
    let cursor = root
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i]!
      const path = parts.slice(0, i + 1).join('/')
      let next = cursor.dirs.get(name)
      if (!next) {
        next = { kind: 'dir', name, path, dirs: new Map(), files: [] }
        cursor.dirs.set(name, next)
      }
      cursor = next
    }
    const name = parts[parts.length - 1]!
    cursor.files.push({ kind: 'file', name, path: entry.path, entry })
  }

  const freeze = (dir: MutableDir): TreeNode[] => {
    const dirs = [...dir.dirs.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(
        (d): DirNode => ({
          kind: 'dir',
          name: d.name,
          path: d.path,
          children: freeze(d)
        })
      )
    const files = [...dir.files].sort((a, b) => a.name.localeCompare(b.name))
    return [...dirs, ...files]
  }

  return freeze(root)
}

type FlatRow =
  | { kind: 'dir'; path: string; name: string; depth: number; expanded: boolean }
  | { kind: 'file'; path: string; name: string; depth: number; entry: GitChangeEntry }

function flattenTree(nodes: TreeNode[], expanded: Set<string>, depth = 0): FlatRow[] {
  const out: FlatRow[] = []
  for (const node of nodes) {
    if (node.kind === 'dir') {
      const isOpen = expanded.has(node.path)
      out.push({
        kind: 'dir',
        path: node.path,
        name: node.name,
        depth,
        expanded: isOpen
      })
      if (isOpen) out.push(...flattenTree(node.children, expanded, depth + 1))
    } else {
      out.push({
        kind: 'file',
        path: node.path,
        name: node.name,
        depth,
        entry: node.entry
      })
    }
  }
  return out
}

function defaultExpanded(nodes: TreeNode[]): Set<string> {
  const set = new Set<string>()
  const walk = (list: TreeNode[]): void => {
    for (const n of list) {
      if (n.kind === 'dir') {
        set.add(n.path)
        walk(n.children)
      }
    }
  }
  walk(nodes)
  return set
}

function DiffLines({ text, filePath }: { text: string; filePath: string }): React.JSX.Element {
  const t = useT()
  const lang = languageFromPath(filePath)
  const [, setHljsTick] = useState(0)
  useEffect(() => onHljsReady(() => setHljsTick((n) => n + 1)), [])

  const lines = text.split('\n')
  const truncated = lines.length > 800
  const [expanded, setExpanded] = useState(false)
  const render = expanded || !truncated ? lines : lines.slice(0, 800)
  const visibleText = expanded || !truncated ? text : render.join('\n')
  const blocks = useMemo(() => parseDiffBlocks(visibleText, filePath), [visibleText, filePath])

  return (
    <>
      <TextBlockPick
        className="git-diff"
        lines={render}
        blocks={blocks}
        sourcePath={`git-diff:${filePath}`}
        badge="DIFF"
        renderLine={(line) => {
          let cls = 'ctx'
          let prefix = ''
          let code = line
          if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ')) {
            cls = 'meta'
          } else if (line.startsWith('@@')) {
            cls = 'hunk'
          } else if (line.startsWith('+')) {
            cls = 'add'
            prefix = '+'
            code = line.slice(1)
          } else if (line.startsWith('-')) {
            cls = 'del'
            prefix = '-'
            code = line.slice(1)
          } else if (line.startsWith(' ')) {
            prefix = ' '
            code = line.slice(1)
          }

          const highlighted =
            cls === 'add' || cls === 'del' || cls === 'ctx'
              ? highlightCode(code, lang)
              : null

          return (
            <div className={`diff-line ${cls}`}>
              {highlighted != null ? (
                <>
                  <span className="diff-prefix" aria-hidden>
                    {prefix || ' '}
                  </span>
                  <span
                    className="diff-code"
                    dangerouslySetInnerHTML={{ __html: highlighted || ' ' }}
                  />
                </>
              ) : (
                <span className="diff-code">{line || ' '}</span>
              )}
            </div>
          )
        }}
      />
      {truncated && !expanded && (
        <button type="button" className="diff-more" onClick={() => setExpanded(true)}>
          … {lines.length - 800} {t('git.moreLines')}
        </button>
      )}
    </>
  )
}

function ImageDiffView({
  cwd,
  entry
}: {
  cwd: string
  entry: GitChangeEntry
}): React.JSX.Element {
  const t = useT()
  const [before, setBefore] = useState<string | null | undefined>(undefined)
  const [after, setAfter] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    setBefore(undefined)
    setAfter(undefined)
    const mime = mimeForImagePath(entry.path)

    void (async () => {
      if (entry.status !== 'added' && entry.status !== 'untracked') {
        if (window.vav?.git?.showBase64) {
          try {
            const res = await window.vav.git.showBase64(cwd, entry.path, 'HEAD')
            if (cancelled) return
            if (res.ok && res.data.base64) {
              setBefore(`data:${mime};base64,${res.data.base64}`)
            } else {
              setBefore(null)
            }
          } catch {
            if (!cancelled) setBefore(null)
          }
        } else if (!cancelled) {
          setBefore(null)
        }
      } else if (!cancelled) {
        setBefore(null)
      }

      if (entry.status !== 'deleted') {
        try {
          const bin = await window.vav.files.readBinary(entry.absolutePath)
          if (cancelled) return
          if (bin.ok) {
            setAfter(`data:${bin.mime || mime};base64,${bin.base64}`)
          } else {
            setAfter(null)
          }
        } catch {
          if (!cancelled) setAfter(null)
        }
      } else if (!cancelled) {
        setAfter(null)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [cwd, entry])

  return (
    <div className="git-image-diff">
      <div className="git-image-col">
        <div className="git-image-label">{t('git.imageBefore')}</div>
        {before === undefined ? (
          <div className="token-usage-muted">{t('common.loading')}</div>
        ) : before ? (
          <img className="git-image-preview" src={before} alt={t('git.imageBefore')} />
        ) : (
          <div className="git-image-missing">{t('git.imageMissing')}</div>
        )}
      </div>
      <div className="git-image-col">
        <div className="git-image-label">{t('git.imageAfter')}</div>
        {after === undefined ? (
          <div className="token-usage-muted">{t('common.loading')}</div>
        ) : after ? (
          <img className="git-image-preview" src={after} alt={t('git.imageAfter')} />
        ) : (
          <div className="git-image-missing">{t('git.imageMissing')}</div>
        )}
      </div>
    </div>
  )
}

export type GitPanelChrome = {
  meta: string | null
  loading: boolean
  refresh: () => void
}

function GitDiffContent({
  cwd,
  entry,
  diff,
  diffError
}: {
  cwd: string
  entry: GitChangeEntry
  diff: string | null
  diffError: string | null
}): React.JSX.Element {
  const t = useT()
  const hostRef = useRef<HTMLDivElement>(null)
  const activeId = useSessionStore((s) => s.activeId)
  const commentCards = useSessionStore((s) => (activeId ? s.commentCards[activeId] : undefined))
  const showSelectionAgentMark = useSessionStore(
    (s) => s.settings.previewSelectionAgentMark !== false
  )
  const selectedIds = useMemo(
    () => selectedBlockIdsForPath(activeId, `git-diff:${entry.path}`),
    [activeId, entry.path, commentCards]
  )
  const showImage =
    isImagePath(entry.path) &&
    (diff == null || looksBinaryDiff(diff) || diff.trim() === '' || diff.includes('(no textual'))

  return (
    <div className="git-diff-stage has-selection-hud" ref={hostRef}>
      <SelectionChrome
        hostRef={hostRef}
        selectedIds={selectedIds}
        enabled
        fab={
          showSelectionAgentMark && selectedIds.length > 0
            ? {
                title: t('preview.agentPanel'),
                onClick: () => useSessionStore.getState().focusComposer()
              }
            : null
        }
      />
      <div className="git-diff-scroll">
        {diffError ? (
          <div className="git-diff-error">{diffError}</div>
        ) : showImage ? (
          <ImageDiffView cwd={cwd} entry={entry} />
        ) : diff == null ? (
          <div className="token-usage-muted">{t('common.loading')}</div>
        ) : looksBinaryDiff(diff) ? (
          <div className="git-binary-note">{t('git.binaryDiff')}</div>
        ) : (
          <DiffLines text={diff} filePath={entry.path} />
        )}
      </div>
    </div>
  )
}

/** Session-right preview: git diff for the selected changed file. */
export function GitDiffPreview({
  cwd,
  entry,
  onClose
}: {
  cwd: string
  entry: GitChangeEntry
  onClose: () => void
}): React.JSX.Element {
  const t = useT()
  const [diff, setDiff] = useState<string | null>(null)
  const [diffError, setDiffError] = useState<string | null>(null)

  useEffect(() => {
    if (!window.vav?.git?.diff) {
      setDiff(null)
      setDiffError(t('git.apiMissing'))
      return
    }
    let cancelled = false
    setDiff(null)
    setDiffError(null)
    void (async () => {
      try {
        const result = await window.vav.git.diff(cwd, entry.path)
        if (cancelled) return
        if (!result.ok) {
          setDiff(null)
          setDiffError(result.error)
          return
        }
        setDiffError(null)
        setDiff(result.data)
      } catch (err) {
        if (cancelled) return
        setDiff(null)
        setDiffError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [cwd, entry.path, t])

  const reveal = (): void => {
    const target = entry.status === 'deleted' ? dirname(entry.absolutePath) : entry.absolutePath
    void window.vav.conversations.revealInFinder(target)
  }

  return (
    <div className="git-preview">
      <header className="workspace-preview-chrome">
        <span className="git-diff-filename" title={entry.path}>
          {entry.path}
        </span>
        <Button
          icon={<FileManagerIcon size={12} />}
          size="sm"
          title={t('git.revealInFm', { fileManager: fileManagerLabel() })}
          onClick={reveal}
        />
        <Button icon={<X size={14} />} size="sm" title={t('common.close')} onClick={onClose} />
      </header>
      <GitDiffContent cwd={cwd} entry={entry} diff={diff} diffError={diffError} />
    </div>
  )
}

/** Files tray → Git: changed files + selected file diff. */
export function GitChangesPanel({
  visible,
  active = true,
  isRepo = null,
  onChrome
}: {
  visible: boolean
  /** Git tab is the one on screen — chrome / preview only then. */
  active?: boolean
  /** Parent probe. `false` → paint enable-VC immediately; don't wait on status. */
  isRepo?: boolean | null
  /** Lift branch/count + refresh into the Files toolbar row. */
  onChrome?: (chrome: GitPanelChrome | null) => void
}): React.JSX.Element {
  const t = useT()
  const activeId = useSessionStore((s) => s.activeId)
  const previewHost = useSessionStore((s) => s.filePreviewHost)
  const filePreviewOpen = useSessionStore((s) => s.filePreviewOpen)
  const sessionPreview = useSessionStore((s) => s.sessionPreview)
  const setSessionPreview = useSessionStore((s) => s.setSessionPreview)
  const setFilePreviewOpen = useSessionStore((s) => s.setFilePreviewOpen)
  const conversation = useSessionStore((s) => s.conversations.find((c) => c.id === s.activeId))
  const tmp = useSessionStore((s) => s.tmp)
  const root = useWorkspaceStore((s) => s.workspaces[activeId]?.root ?? null)
  /** Temp dirs can become repos after Files → Git “enable version control”. */
  const gitRepoEpoch = useGitRepoSyncEpoch()
  const cwd = conversation?.workingDirectory ?? root
  const temporary = isTemporaryWorkspace(cwd, tmp)

  const [snap, setSnap] = useState<GitSnapshot | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [diff, setDiff] = useState<string | null>(null)
  const [diffError, setDiffError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [initing, setIniting] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [focusIndex, setFocusIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const tree = useMemo(
    () => (snap?.isRepo ? buildChangeTree(snap.changes) : []),
    [snap]
  )

  useEffect(() => {
    if (!snap?.isRepo) return
    setExpanded(defaultExpanded(tree))
  }, [snap?.cwd, snap?.isRepo, tree])

  const rows = useMemo(() => flattenTree(tree, expanded), [tree, expanded])

  const selectedEntry = useMemo(
    () => snap?.changes.find((c) => c.path === selected) ?? null,
    [snap, selected]
  )

  const refresh = useCallback(async (): Promise<void> => {
    if (!root) {
      setSnap(null)
      setSelected(null)
      setDiff(null)
      setLoadError(null)
      return
    }
    if (!window.vav?.git?.status) {
      setSnap(null)
      setLoadError(tt('git.apiMissing'))
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      const next = await window.vav.git.status(root)
      setSnap(next)
      setSelected((prev) => {
        if (prev && next.changes.some((c) => c.path === prev)) return prev
        return next.changes[0]?.path ?? null
      })
    } catch (err) {
      setSnap(null)
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [root, gitRepoEpoch])

  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  const stableRefresh = useCallback(() => {
    void refreshRef.current()
  }, [])

  useEffect(() => {
    if (!visible) return
    void refresh()
  }, [visible, refresh])

  useEffect(() => {
    if (!onChrome) return
    if (!active || !visible || !root || !snap?.isRepo) {
      onChrome(null)
      return
    }
    onChrome({
      meta: `${snap.branch || t('git.detached', { head: snap.headShort ?? '?' })} · ${t('git.changeCount', { n: snap.changes.length })}`,
      loading,
      refresh: stableRefresh
    })
  }, [onChrome, active, visible, root, snap, loading, stableRefresh, t])

  useEffect(() => {
    return () => onChrome?.(null)
  }, [onChrome])

  useEffect(() => {
    if (!active || !visible || !previewHost || !root || !selectedEntry) return
    if (!filePreviewOpen || sessionPreview.kind !== 'git') return
    setSessionPreview({ kind: 'git', cwd: root, entry: selectedEntry })
  }, [
    active,
    visible,
    previewHost,
    root,
    selectedEntry,
    filePreviewOpen,
    sessionPreview.kind,
    setSessionPreview
  ])

  useEffect(() => {
    if (previewHost || !active || !visible || !root || !selected || !snap?.isRepo) {
      setDiff(null)
      setDiffError(null)
      return
    }
    if (!window.vav?.git?.diff) {
      setDiff(null)
      setDiffError(t('git.apiMissing'))
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const result = await window.vav.git.diff(root, selected)
        if (cancelled) return
        if (!result.ok) {
          setDiff(null)
          setDiffError(result.error)
          return
        }
        setDiffError(null)
        setDiff(result.data)
      } catch (err) {
        if (cancelled) return
        setDiff(null)
        setDiffError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [previewHost, active, visible, root, selected, snap?.isRepo, t])

  // Keep focusIndex aligned with selected file when selection changes.
  useEffect(() => {
    if (!selected) return
    const idx = rows.findIndex((r) => r.kind === 'file' && r.path === selected)
    if (idx >= 0) setFocusIndex(idx)
  }, [selected, rows])

  const revealSelected = useCallback((): void => {
    if (!selectedEntry) return
    const target =
      selectedEntry.status === 'deleted'
        ? dirname(selectedEntry.absolutePath)
        : selectedEntry.absolutePath
    void window.vav.conversations.revealInFinder(target)
  }, [selectedEntry])

  const initRepo = useCallback(async (): Promise<void> => {
    if (!cwd || !window.vav?.git?.init) {
      setInitError(t('git.apiMissing'))
      return
    }
    setIniting(true)
    setInitError(null)
    try {
      const result = await window.vav.git.init(cwd)
      if (!result.ok) {
        setInitError(result.error)
        return
      }
      setSnap(result.data)
      bumpGitRepoSync()
      await refresh()
    } catch (err) {
      setInitError(err instanceof Error ? err.message : String(err))
    } finally {
      setIniting(false)
    }
  }, [cwd, refresh, t])

  const toggleDir = (path: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const previewGitEntry = (entry: GitChangeEntry): void => {
    if (!root) return
    setSelected(entry.path)
    setSessionPreview({ kind: 'git', cwd: root, entry })
    setFilePreviewOpen(true)
  }

  const showGitEntryMenu = (entry: GitChangeEntry, x: number, y: number): void => {
    const items: MenuItem[] = [
      { label: t('common.preview'), onSelect: () => previewGitEntry(entry) },
      {
        label: t('git.revealInFm', { fileManager: fileManagerLabel() }),
        onSelect: () => void window.vav.conversations.revealInFinder(entry.absolutePath)
      }
    ]
    void showMenu(items, { x, y })
  }

  const onListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (rows.length === 0) return
    const move = (delta: number): void => {
      event.preventDefault()
      setFocusIndex((prev) => {
        const next = Math.max(0, Math.min(rows.length - 1, prev + delta))
        const row = rows[next]
        if (row?.kind === 'file') setSelected(row.path)
        requestAnimationFrame(() => {
          listRef.current
            ?.querySelector(`[data-git-row="${next}"]`)
            ?.scrollIntoView({ block: 'nearest' })
        })
        return next
      })
    }

    if (event.key === 'ArrowDown') move(1)
    else if (event.key === 'ArrowUp') move(-1)
    else if (event.key === 'Home') {
      event.preventDefault()
      setFocusIndex(0)
      const row = rows[0]
      if (row?.kind === 'file') setSelected(row.path)
    } else if (event.key === 'End') {
      event.preventDefault()
      const last = rows.length - 1
      setFocusIndex(last)
      const row = rows[last]
      if (row?.kind === 'file') setSelected(row.path)
    } else if (event.key === 'Enter' || event.key === ' ') {
      const row = rows[focusIndex]
      if (!row) return
      event.preventDefault()
      if (row.kind === 'dir') toggleDir(row.path)
      else previewGitEntry(row.entry)
    } else if (event.key === 'ArrowRight') {
      const row = rows[focusIndex]
      if (row?.kind === 'dir' && !row.expanded) {
        event.preventDefault()
        toggleDir(row.path)
      }
    } else if (event.key === 'ArrowLeft') {
      const row = rows[focusIndex]
      if (row?.kind === 'dir' && row.expanded) {
        event.preventDefault()
        toggleDir(row.path)
      }
    }
  }

  if (!root) {
    return (
      <div className="git-panel">
        <EmptyState title={t('git.needProject')} description={t('git.needProjectDesc')} />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="git-panel">
        <EmptyState title={t('git.loadFailed')} description={loadError} />
      </div>
    )
  }

  if (!snap?.isRepo) {
    if (isRepo === true && !snap) {
      return <div className="git-panel" aria-busy="true" />
    }
    const projectName = temporary
      ? t('sidebar.defaultWorkspace')
      : workdirShortLabel(cwd, tmp)
    return (
      <div className="git-panel git-panel-not-repo">
        <EnableVersionControlChrome
          projectName={projectName}
          temporary={temporary}
          busy={initing}
          error={initError || snap?.error || null}
          onInit={() => void initRepo()}
        />
      </div>
    )
  }

  return (
    <div className="git-panel">
      {snap.changes.length === 0 ? (
        <EmptyState title={t('git.clean')} description={t('git.cleanDesc')} />
      ) : (
        <div className={`git-panel-body${previewHost ? ' is-list-only' : ''}`}>
          <div
            ref={listRef}
            className="git-change-list"
            role="tree"
            tabIndex={0}
            aria-label={t('git.changes')}
            onKeyDown={onListKeyDown}
          >
            {rows.map((row, index) => {
              const focused = index === focusIndex
              if (row.kind === 'dir') {
                return (
                  <button
                    key={`d:${row.path}`}
                    type="button"
                    role="treeitem"
                    aria-expanded={row.expanded}
                    data-git-row={index}
                    className={`git-change-row git-change-dir${focused ? ' is-focused' : ''}`}
                    style={{ paddingLeft: 8 + row.depth * 14 }}
                    onClick={() => {
                      setFocusIndex(index)
                      toggleDir(row.path)
                    }}
                  >
                    <span className="git-dir-chevron" aria-hidden>
                      {row.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </span>
                    <span className="git-change-path" title={row.path}>
                      {row.name}
                    </span>
                  </button>
                )
              }
              const selectedRow = selected === row.path
              return (
                <button
                  key={`f:${row.path}`}
                  type="button"
                  role="treeitem"
                  aria-selected={selectedRow}
                  data-git-row={index}
                  className={`git-change-row${selectedRow ? ' is-selected' : ''}${
                    focused ? ' is-focused' : ''
                  }`}
                  style={{ paddingLeft: 8 + row.depth * 14 }}
                  onClick={() => {
                    setFocusIndex(index)
                    setSelected(row.path)
                  }}
                  onDoubleClick={() => previewGitEntry(row.entry)}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    setFocusIndex(index)
                    setSelected(row.path)
                    showGitEntryMenu(row.entry, event.clientX, event.clientY)
                  }}
                >
                  <span className={`git-status git-status-${row.entry.status}`}>
                    {statusLetter(row.entry)}
                  </span>
                  <span className="git-change-path" title={row.path}>
                    {row.name}
                  </span>
                </button>
              )
            })}
          </div>
          {!previewHost ? (
            <div className="git-diff-pane">
              {selectedEntry && (
                <div className="git-diff-header">
                  <span className="git-diff-filename" title={selectedEntry.path}>
                    {selectedEntry.path}
                  </span>
                  <Button
                    icon={<FileManagerIcon size={12} />}
                    size="sm"
                    title={t('git.revealInFm', { fileManager: fileManagerLabel() })}
                    onClick={revealSelected}
                  />
                </div>
              )}
              {selectedEntry ? (
                <GitDiffContent
                  cwd={root}
                  entry={selectedEntry}
                  diff={diff}
                  diffError={diffError}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
