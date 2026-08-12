import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { GitChangeEntry, GitSnapshot } from '@shared/git'
import { useSessionStore } from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { useT, tt } from '../i18n/useT'
import { isTemporaryWorkspace } from '../lib/format'
import { fileManagerLabel } from '../lib/platform'
import { highlightCode, languageFromPath } from '../lib/highlightCode'
import { onHljsReady } from '../lib/hljsLazy'
import { dirname } from '../lib/path'
import { FileManagerIcon } from './FileManagerIcon'
import { Button, EmptyState } from './ui'

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

  return (
    <pre className="git-diff">
      {render.map((line, i) => {
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
          <div key={i} className={`diff-line ${cls}`}>
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
      })}
      {truncated && !expanded && (
        <button type="button" className="diff-more" onClick={() => setExpanded(true)}>
          … {lines.length - 800} {t('git.moreLines')}
        </button>
      )}
    </pre>
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

/** Files tray → Git: changed files + selected file diff. */
export function GitChangesPanel({
  visible,
  onChrome
}: {
  visible: boolean
  /** Lift branch/count + refresh into the Files toolbar row. */
  onChrome?: (chrome: GitPanelChrome | null) => void
}): React.JSX.Element {
  const t = useT()
  const activeId = useSessionStore((s) => s.activeId)
  const tmp = useSessionStore((s) => s.tmp)
  const root = useWorkspaceStore((s) => s.workspaces[activeId]?.root ?? null)
  const temporary = isTemporaryWorkspace(root, tmp)

  const [snap, setSnap] = useState<GitSnapshot | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [diff, setDiff] = useState<string | null>(null)
  const [diffError, setDiffError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
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
    if (!root || temporary) {
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
  }, [root, temporary])

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
    if (!visible || !root || temporary) {
      onChrome(null)
      return
    }
    const meta =
      snap?.isRepo
        ? `${snap.branch || t('git.detached', { head: snap.headShort ?? '?' })} · ${t('git.changeCount', { n: snap.changes.length })}`
        : null
    onChrome({ meta, loading, refresh: stableRefresh })
  }, [onChrome, visible, root, temporary, snap, loading, stableRefresh, t])

  useEffect(() => {
    return () => onChrome?.(null)
  }, [onChrome])

  useEffect(() => {
    if (!visible || !root || !selected || !snap?.isRepo) {
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
  }, [visible, root, selected, snap?.isRepo, t])

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

  const toggleDir = (path: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
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
      else setSelected(row.path)
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

  if (!root || temporary) {
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

  if (!snap) {
    return (
      <div className="git-panel">
        <EmptyState
          title={loading ? t('common.loading') : t('git.loadFailed')}
          description={loading ? undefined : t('git.apiMissing')}
        />
      </div>
    )
  }

  if (!snap.isRepo) {
    return (
      <div className="git-panel">
        <EmptyState title={t('git.notARepo')} description={t('git.notARepoDesc')} />
      </div>
    )
  }

  const showImage =
    !!selectedEntry &&
    isImagePath(selectedEntry.path) &&
    (diff == null || looksBinaryDiff(diff) || diff.trim() === '' || diff.includes('(no textual'))

  return (
    <div className="git-panel">
      {snap.changes.length === 0 ? (
        <EmptyState title={t('git.clean')} description={t('git.cleanDesc')} />
      ) : (
        <div className="git-panel-body">
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
                  onDoubleClick={() => {
                    void window.vav.conversations.revealInFinder(row.entry.absolutePath)
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
            <div className="git-diff-scroll">
              {diffError ? (
                <div className="git-diff-error">{diffError}</div>
              ) : showImage && selectedEntry ? (
                <ImageDiffView cwd={root} entry={selectedEntry} />
              ) : diff == null ? (
                <div className="token-usage-muted">{t('common.loading')}</div>
              ) : looksBinaryDiff(diff) ? (
                <div className="git-binary-note">{t('git.binaryDiff')}</div>
              ) : (
                <DiffLines text={diff} filePath={selected ?? ''} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
