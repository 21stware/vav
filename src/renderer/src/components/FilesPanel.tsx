import { useCallback, useEffect, useState } from 'react'
import {
  ArrowUpDown,
  Cloud,
  Columns3,
  Folder,
  GitBranch,
  Github,
  Info,
  List,
  FolderInput,
  Plus,
  RefreshCw
} from 'lucide-react'
import { IGNORED_NAMES, IGNORED_SUFFIXES } from '@shared/types'
import {
  FILE_SORT_OPTIONS,
  normalizeFileSortKey,
  type FileSortKey,
  type FileViewMode
} from '@shared/types'
import { fileSortLabelKey } from '@shared/i18n'
import { useSessionStore } from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { useT } from '../i18n/useT'
import { isTemporaryWorkspace } from '../lib/format'
import { entryInDir, selectionParent, sortButtonLabel } from '../lib/filesPanelNav'
import { useGitRepoSyncEpoch } from '../lib/gitRepoSync'
import { dirname, joinPath } from '../lib/path'
import { menuAnchor, showMenu, type MenuItem } from '../lib/nativeMenu'
import { fileManagerLabel } from '../lib/platform'
import { getUiFocusScope, setUiFocusScope } from '../lib/uiFocus'
import { Button, EmptyState, InlineAlert, Segmented } from './ui'
import { FileManagerIcon } from './FileManagerIcon'
import { GitChangesPanel, type GitPanelChrome } from './GitChangesPanel'
import { GithubPanel, type GithubPanelChrome } from './GithubPanel'
import { SupabasePanel, type SupabasePanelChrome } from './SupabasePanel'
import { SupabaseMark } from './SupabaseMark'
import { CloudflarePanel, type CloudflarePanelChrome } from './CloudflarePanel'
import { openFileInSessionPreview } from '../lib/openSessionFile'
import { ColumnBrowser, TreeLevel } from './filesPanel/FilesBrowser'
import {
  isCloudflareTrayEnabled,
  isGithubTrayEnabled,
  isSupabaseTrayEnabled
} from '@shared/workspaceTrays'

type FilesTrayView = 'files' | 'git' | 'github' | 'supabase' | 'cloudflare'

/** Scroll the row for `path` into view inside the files browser. */
function scrollFileRowIntoView(path: string): void {
  requestAnimationFrame(() => {
    try {
      const el = document.querySelector(
        `.files-browser [data-file-path="${CSS.escape(path)}"]`
      ) as HTMLElement | null
      el?.scrollIntoView({ block: 'nearest' })
    } catch {
      // CSS.escape may throw on odd paths — ignore
    }
  })
}

export function FilesPanel({ visible }: { visible: boolean }): React.JSX.Element {
  const t = useT()
  const activeId = useSessionStore((s) => s.activeId)
  const showDialog = useSessionStore((s) => s.showDialog)
  const conversation = useSessionStore((s) => s.conversations.find((c) => c.id === s.activeId))
  const tmp = useSessionStore((s) => s.tmp)
  const locateWorkspace = useSessionStore((s) => s.locateWorkspace)
  const settings = useSessionStore((s) => s.settings)
  const updateSettings = useSessionStore((s) => s.updateSettings)
  // Narrow selectors — CLI host / PTY hydrate mutates tabs & layout constantly;
  // subscribing to the whole workspace slice re-renders the Files browser every tick.
  const root = useWorkspaceStore((s) => s.workspaces[activeId]?.root ?? null)
  const sort = useWorkspaceStore((s) => s.workspaces[activeId]?.sort ?? 'name')
  const ascending = useWorkspaceStore((s) => s.workspaces[activeId]?.ascending ?? true)
  const selectedPath = useWorkspaceStore((s) => s.workspaces[activeId]?.selectedPath ?? null)
  const expanded = useWorkspaceStore((s) => s.workspaces[activeId]?.expanded)
  const dirs = useWorkspaceStore((s) => s.workspaces[activeId]?.dirs)
  const rootError = useWorkspaceStore((s) => {
    const r = s.workspaces[activeId]?.root
    return r ? s.workspaces[activeId]?.dirErrors[r] : undefined
  })
  const ensureFilesLoaded = useWorkspaceStore((s) => s.ensureFilesLoaded)
  const setSort = useWorkspaceStore((s) => s.setSort)
  const selectPathRaw = useWorkspaceStore((s) => s.selectPath)
  const attachContextFile = useSessionStore((s) => s.attachContextFile)
  const setSessionPreview = useSessionStore((s) => s.setSessionPreview)
  /** Select tree path and drive the File Attachment Chip (files only). */
  const selectPath = (
    id: string,
    path: string | null,
    kind: 'file' | 'dir' | 'clear' = path ? 'file' : 'clear'
  ): void => {
    selectPathRaw(id, path)
    if (kind === 'file' && path) {
      void attachContextFile(id, path)
    } else if (kind === 'clear' || kind === 'dir') {
      void attachContextFile(id, null)
    }
  }
  const loadDirectory = useWorkspaceStore((s) => s.loadDirectory)
  const temporary = isTemporaryWorkspace(conversation?.workingDirectory ?? null, tmp)
  const viewMode: FileViewMode = settings.fileViewMode ?? 'tree'
  const [columnPath, setColumnPath] = useState<string[]>([])
  const [displayMode, setDisplayMode] = useState<FileViewMode>(viewMode)
  const [browserOpaque, setBrowserOpaque] = useState(true)
  /** Inline “new file” row: parent dir + draft name. */
  const [creating, setCreating] = useState<{ dir: string; name: string } | null>(null)
  const [trayView, setTrayViewState] = useState<FilesTrayView>('files')
  const [rootIsGit, setRootIsGit] = useState<boolean | null>(null)
  const [hasSupabase, setHasSupabase] = useState<boolean | null>(null)
  const [hasCloudflare, setHasCloudflare] = useState(false)
  const githubTrayOn = isGithubTrayEnabled(settings)
  const supabaseTrayOn = isSupabaseTrayEnabled(settings)
  const cloudflareTrayOn = isCloudflareTrayEnabled(settings)
  const [gitChrome, setGitChrome] = useState<GitPanelChrome | null>(null)
  const [githubChrome, setGithubChrome] = useState<GithubPanelChrome | null>(null)
  const [supabaseChrome, setSupabaseChrome] = useState<SupabasePanelChrome | null>(null)
  const [cloudflareChrome, setCloudflareChrome] = useState<CloudflarePanelChrome | null>(null)
  /** Temp dirs can become repos after Files → Git “enable version control”. */
  const gitRepoEpoch = useGitRepoSyncEpoch()
  const supabaseHint = (dirs?.[root ?? ''] ?? [])
    .filter((entry) => entry.name === 'supabase' || entry.name.startsWith('.env'))
    .map((entry) => entry.name)
    .join(',')
  const onGitChrome = useCallback((next: GitPanelChrome | null) => {
    setGitChrome((prev) => {
      if (prev === next) return prev
      if (
        prev &&
        next &&
        prev.meta === next.meta &&
        prev.loading === next.loading &&
        prev.refresh === next.refresh
      ) {
        return prev
      }
      return next
    })
  }, [])
  const onGithubChrome = useCallback((next: GithubPanelChrome | null) => {
    setGithubChrome((prev) => {
      if (prev === next) return prev
      if (
        prev &&
        next &&
        prev.meta === next.meta &&
        prev.loading === next.loading &&
        prev.refresh === next.refresh
      ) {
        return prev
      }
      return next
    })
  }, [])
  const onSupabaseChrome = useCallback((next: SupabasePanelChrome | null) => {
    setSupabaseChrome((prev) => {
      if (prev === next) return prev
      if (
        prev &&
        next &&
        prev.meta === next.meta &&
        prev.loading === next.loading &&
        prev.refresh === next.refresh
      ) {
        return prev
      }
      return next
    })
  }, [])
  const onCloudflareChrome = useCallback((next: CloudflarePanelChrome | null) => {
    setCloudflareChrome((prev) => {
      if (prev === next) return prev
      if (
        prev &&
        next &&
        prev.meta === next.meta &&
        prev.loading === next.loading &&
        prev.refresh === next.refresh
      ) {
        return prev
      }
      return next
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!root || !window.vav?.git?.status) {
      setRootIsGit(false)
      return
    }
    setRootIsGit(null)
    void window.vav.git
      .status(root)
      .then((snap) => {
        if (!cancelled) setRootIsGit(!!snap.isRepo)
      })
      .catch(() => {
        if (!cancelled) setRootIsGit(false)
      })
    return () => {
      cancelled = true
    }
  }, [root, gitRepoEpoch])

  useEffect(() => {
    let cancelled = false
    if (!supabaseTrayOn || !root || !window.vav?.supabase?.status) {
      setHasSupabase(false)
      return
    }
    setHasSupabase(null)
    void window.vav.supabase
      .status(root, { remote: false })
      .then((result) => {
        if (!cancelled) setHasSupabase(result.ok && result.data.present)
      })
      .catch(() => {
        if (!cancelled) setHasSupabase(false)
      })
    return () => {
      cancelled = true
    }
  }, [root, visible, supabaseHint, supabaseTrayOn])

  const setTrayView = (view: FilesTrayView): void => {
    setTrayViewState(view)
    if (view === 'files') setSessionPreview({ kind: 'file' })
  }

  // GitHub needs a repo; Git stays available so a plain folder can be inited.
  useEffect(() => {
    if ((!githubTrayOn || rootIsGit !== true) && trayView === 'github') setTrayView('files')
  }, [githubTrayOn, rootIsGit, trayView])

  useEffect(() => {
    if (hasSupabase !== true && trayView === 'supabase') setTrayView('files')
  }, [hasSupabase, trayView])

  useEffect(() => {
    let cancelled = false
    if (!cloudflareTrayOn || !root || !window.vav?.cloudflare?.status) {
      setHasCloudflare(false)
      return
    }
    void window.vav.cloudflare
      .status(root, { remote: false })
      .then((result) => {
        if (!cancelled) setHasCloudflare(result.ok && Boolean(result.data.config))
      })
      .catch(() => {
        if (!cancelled) setHasCloudflare(false)
      })
    return () => {
      cancelled = true
    }
  }, [root, visible, cloudflareTrayOn])

  useEffect(() => {
    if (!hasCloudflare && trayView === 'cloudflare') setTrayView('files')
  }, [hasCloudflare, trayView])

  useEffect(() => {
    if (visible && activeId && trayView === 'files') void ensureFilesLoaded(activeId)
  }, [visible, activeId, ensureFilesLoaded, trayView])

  // Restore Finder sort prefs into the active workspace once when it appears.
  useEffect(() => {
    if (!activeId || !root) return
    const key = normalizeFileSortKey(settings.fileSortKey)
    const sortAscending = settings.fileSortAscending ?? true
    if (sort === key && ascending === sortAscending) return
    void setSort(activeId, key, sortAscending)
    // Only sync from persisted settings when the workspace first binds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, root])

  useEffect(() => {
    setColumnPath([])
  }, [root])

  useEffect(() => {
    // Keep the browser visible when modes already match — a cancelled mid-fade
    // must not leave `data-opaque` unset (opacity: 0 forever).
    if (viewMode === displayMode) {
      setBrowserOpaque(true)
      return
    }
    setBrowserOpaque(false)
    const timer = window.setTimeout(() => {
      setDisplayMode(viewMode)
      requestAnimationFrame(() => setBrowserOpaque(true))
    }, 140) // --dur-hover
    return () => {
      window.clearTimeout(timer)
      setBrowserOpaque(true)
    }
  }, [viewMode, displayMode])

  const rootMissing =
    !!rootError &&
    (rootError === 'ENOENT' || /enoent|no such file|not found/i.test(rootError))

  const openViewer = (path: string): void => {
    void window.vav.window.openFilePreview(path, {
      origin: 'session',
      conversationId: activeId
    })
  }

  /**
   * Finder-style keyboard (UiFocusScope `files`):
   * - ↑↓ move among **siblings in the current directory only**
   * - Focusing a folder **shows its children** (tree expand / column open)
   * - → enter folder and focus **first child**
   * - ← leave to parent (at root: collapse open folder; never select invisible root)
   * - Enter / Space / double-click: side preview
   * Highlight only on arrows — no attachContext / preview per key.
   */
  useEffect(() => {
    if (!visible || !root || rootMissing) return
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable
      ) {
        return
      }
      const inBrowser = !!target?.closest?.('.files-browser')
      if (!inBrowser && getUiFocusScope() !== 'files') return

      const ws = useWorkspaceStore.getState().workspaces[activeId]
      const workRoot = ws?.root
      if (!workRoot) return
      const dirMap = ws.dirs
      let selected = ws.selectedPath
      const mode = displayMode
      const key = event.key

      const isNav =
        key === 'ArrowDown' ||
        key === 'ArrowUp' ||
        key === 'ArrowLeft' ||
        key === 'ArrowRight' ||
        key === 'Enter' ||
        key === ' ' ||
        key === 'Spacebar'
      if (!isNav) return

      // —— Space: side preview ——
      if (key === ' ' || key === 'Spacebar') {
        if (!selected) return
        if (target?.closest?.('button')) return
        event.preventDefault()
        setUiFocusScope('files')
        openFileInSessionPreview(selected)
        return
      }

      event.preventDefault()
      setUiFocusScope('files')

      /** Open folder columns from root → … → folder (exclusive of files). */
      const columnChainTo = (folderPath: string): string[] => {
        if (folderPath === workRoot) return []
        const chain: string[] = []
        let cur: string = folderPath
        while (cur && cur !== workRoot) {
          chain.unshift(cur)
          const p = dirname(cur)
          if (!p || p === cur) break
          cur = p
        }
        return chain
      }

      /**
       * Highlight a path. Directories also reveal children (expand / open column)
       * without moving focus into the child list.
       */
      const highlight = (path: string, asDir: boolean): void => {
        selectPathRaw(activeId, path)
        selected = path
        if (asDir) {
          if (mode === 'tree') {
            if (!ws.expanded.includes(path)) {
              void useWorkspaceStore.getState().toggleExpand(activeId, path)
            }
          } else {
            setColumnPath(columnChainTo(path))
            void loadDirectory(activeId, path)
          }
        } else if (mode === 'column') {
          // File: columns up through parent only.
          const parent = selectionParent(path, workRoot, dirMap)
          setColumnPath(parent === workRoot ? [] : columnChainTo(parent))
        }
        scrollFileRowIntoView(path)
      }

      // Active directory = parent of selection (↑↓ only move among these siblings).
      const navDir = selectionParent(selected, workRoot, dirMap)
      const siblings = dirMap?.[navDir] ?? []
      const entry = entryInDir(navDir, selected, dirMap)

      // Seed: first root entry when nothing selected.
      if (!selected && key !== 'Enter') {
        const rootList = dirMap?.[workRoot] ?? []
        if (rootList.length === 0) {
          void loadDirectory(activeId, workRoot)
          return
        }
        if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'ArrowRight') {
          const first = rootList[0]!
          highlight(first.path, first.isDirectory)
          return
        }
      }

      if (key === 'ArrowDown' || key === 'ArrowUp') {
        const list = siblings.length > 0 ? siblings : (dirMap?.[workRoot] ?? [])
        if (list.length === 0) return
        const delta = key === 'ArrowDown' ? 1 : -1
        const idx = selected ? list.findIndex((e) => e.path === selected) : -1
        const base = idx < 0 ? (delta > 0 ? -1 : 0) : idx
        const next = list[base + delta]
        if (next) highlight(next.path, next.isDirectory)
        return
      }

      if (key === 'ArrowRight') {
        // Enter folder → reveal children, focus first child.
        if (!entry?.isDirectory) return
        const folder = entry.path
        if (mode === 'tree') {
          if (!ws.expanded.includes(folder)) {
            void useWorkspaceStore.getState().toggleExpand(activeId, folder)
          }
        } else {
          setColumnPath(columnChainTo(folder))
        }
        void loadDirectory(activeId, folder).then(() => {
          const kids =
            useWorkspaceStore.getState().workspaces[activeId]?.dirs[folder] ?? []
          const first = kids[0]
          if (!first) {
            selectPathRaw(activeId, folder)
            return
          }
          // Focus first child; if it is a dir, show *its* children too.
          highlight(first.path, first.isDirectory)
        })
        return
      }

      if (key === 'ArrowLeft') {
        // Root listing: collapse revealed folder (keep row selected). Never select
        // the invisible workspace root path.
        if (navDir === workRoot) {
          if (entry?.isDirectory) {
            if (mode === 'tree' && ws.expanded.includes(entry.path)) {
              void useWorkspaceStore.getState().toggleExpand(activeId, entry.path)
            } else if (mode === 'column' && columnPath[0] === entry.path) {
              setColumnPath([])
              selectPathRaw(activeId, entry.path)
              scrollFileRowIntoView(entry.path)
            }
          }
          return
        }

        // Inside a subfolder: select the parent folder row and show its content.
        const parentFolder = navDir
        if (mode === 'tree') {
          selectPathRaw(activeId, parentFolder)
          // Keep parent expanded so we still see siblings of the dir we left.
          scrollFileRowIntoView(parentFolder)
        } else {
          // Parent is a root child → columnPath = [parent] so its content shows.
          // Deeper → chain ending at parent.
          setColumnPath(columnChainTo(parentFolder))
          selectPathRaw(activeId, parentFolder)
          void loadDirectory(activeId, parentFolder)
          scrollFileRowIntoView(parentFolder)
        }
        return
      }

      if (key === 'Enter') {
        if (!entry) return
        if (entry.isDirectory) {
          // Toggle reveal (→ still enters first child).
          if (mode === 'tree') {
            void useWorkspaceStore.getState().toggleExpand(activeId, entry.path)
          } else {
            const open = columnPath.includes(entry.path)
            if (open) {
              // Close this folder column and deeper.
              const idx = columnPath.indexOf(entry.path)
              setColumnPath(columnPath.slice(0, idx))
            } else {
              highlight(entry.path, true)
            }
          }
        } else {
          selectPath(activeId, entry.path, 'file')
          openFileInSessionPreview(entry.path)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    visible,
    activeId,
    root,
    rootMissing,
    displayMode,
    columnPath,
    selectPath,
    selectPathRaw,
    loadDirectory
  ])

  if (!root) {
    return (
      <EmptyState title={t('files.noWorkdirTitle')} description={t('files.noWorkdirDesc')} />
    )
  }

  const applySort = (key: FileSortKey): void => {
    const next = normalizeFileSortKey(key)
    const nextAscending = next !== 'none' && sort === next ? !ascending : true
    void setSort(activeId, next, nextAscending)
    void updateSettings({ fileSortKey: next, fileSortAscending: nextAscending })
  }

  const sortItems: MenuItem[] = FILE_SORT_OPTIONS.map((option) => ({
    label: t(fileSortLabelKey(option.key)),
    checked: normalizeFileSortKey(sort) === option.key,
    onSelect: () => applySort(option.key)
  }))

  const refreshParent = (path: string): void => {
    void loadDirectory(activeId, dirname(path))
  }

  const toggleViewMode = (): void => {
    const next: FileViewMode = viewMode === 'tree' ? 'column' : 'tree'
    void updateSettings({ fileViewMode: next })
  }

  /** Directory that owns the next “new file” (focused folder, else parent of file, else root). */
  const resolveCreateDir = (): string | null => {
    if (!root) return null
    const sel = selectedPath
    if (!sel || sel === root) return root
    for (const entries of Object.values(dirs ?? {})) {
      const hit = entries.find((e) => e.path === sel)
      if (hit) return hit.isDirectory ? hit.path : dirname(hit.path)
    }
    // Column navigation may select a folder path not yet listed as an entry.
    if (columnPath.includes(sel)) return sel
    return dirname(sel) || root
  }

  const startCreateFile = (): void => {
    const dir = resolveCreateDir()
    if (!dir || !root) return
    // Ensure the target folder is expanded in tree view so the inline row is visible.
    const open = expanded ?? []
    if (dir !== root && !open.includes(dir)) {
      void useWorkspaceStore.getState().toggleExpand(activeId, dir)
    }
    // Column browser: open the parent column if needed.
    if (displayMode === 'column' && dir !== root) {
      const parent = dirname(dir)
      const base = parent === root ? [] : columnPath
      if (!columnPath.includes(dir) && dir !== root) {
        // Keep ancestors; append dir as last open folder.
        const idx = columnPath.indexOf(parent)
        if (idx >= 0) setColumnPath([...columnPath.slice(0, idx + 1), dir])
        else if (parent === root) setColumnPath([dir])
        else setColumnPath([...base, dir].filter((p, i, a) => a.indexOf(p) === i))
      }
    }
    selectPath(activeId, dir, 'dir')
    setCreating({ dir, name: '' })
  }

  const cancelCreateFile = (): void => setCreating(null)

  const commitCreateFile = async (name: string): Promise<void> => {
    if (!creating) return
    const trimmed = name.trim()
    if (!trimmed || /[/\\]/.test(trimmed) || trimmed === '.' || trimmed === '..') {
      showDialog({
        title: t('files.error.badName'),
        body: t('files.error.badName'),
        confirmLabel: t('common.ok')
      })
      return
    }
    const full = joinPath(creating.dir, trimmed)
    const result = await window.vav.files.write(full, '', activeId)
    if (!result.ok) {
      showDialog({
        title: t('files.createFailed'),
        body: result.error ?? t('files.createFailed'),
        confirmLabel: t('common.ok')
      })
      return
    }
    setCreating(null)
    void loadDirectory(activeId, creating.dir)
    selectPath(activeId, full, 'file')
    openViewer(full)
  }

  return (
    <>
      <div className="files-toolbar">
        <div className="files-toolbar-tabs">
          <Segmented<FilesTrayView>
            value={trayView}
            onChange={setTrayView}
            options={[
              {
                value: 'files',
                label: t('files.tabFiles'),
                title: t('files.tabFiles'),
                icon: <Folder size={14} />
              },
              {
                value: 'git',
                label: t('files.tabGit'),
                title: t('files.tabGit'),
                icon: <GitBranch size={14} />
              },
              ...(githubTrayOn && rootIsGit === true
                ? [
                    {
                      value: 'github' as const,
                      label: t('files.tabGithub'),
                      title: t('files.tabGithub'),
                      icon: <Github size={14} />
                    }
                  ]
                : []),
              ...(supabaseTrayOn && hasSupabase === true
                ? [
                    {
                      value: 'supabase' as const,
                      label: t('files.tabSupabase'),
                      title: t('files.tabSupabase'),
                      icon: <SupabaseMark size={14} />
                    }
                  ]
                : []),
              ...(cloudflareTrayOn && hasCloudflare
                ? [
                    {
                      value: 'cloudflare' as const,
                      label: t('files.tabCloudflare'),
                      title: t('files.tabCloudflare'),
                      icon: <Cloud size={14} />
                    }
                  ]
                : [])
            ]}
          />
        </div>
        {/* Push actions to the trailing edge. */}
        <span className="files-toolbar-spacer" aria-hidden />
        <div className="files-toolbar-actions">
          {trayView === 'files' && (
            <>
              <Button
                label={sortButtonLabel(normalizeFileSortKey(sort), t)}
                icon={<ArrowUpDown size={14} />}
                size="sm"
                title={t('common.sort')}
                onClick={(event) =>
                  void showMenu(sortItems, menuAnchor(event.currentTarget as HTMLElement))
                }
              />
              <Button
                icon={<Plus size={14} />}
                size="sm"
                testId="files-new-file"
                title={t('files.newFile')}
                disabled={rootMissing}
                onClick={startCreateFile}
              />
              <Button
                icon={viewMode === 'tree' ? <List size={14} /> : <Columns3 size={14} />}
                size="sm"
                testId="files-view-mode"
                title={viewMode === 'tree' ? t('files.viewList') : t('files.viewColumn')}
                disabled={rootMissing}
                onClick={toggleViewMode}
              />
              <Button
                icon={<FileManagerIcon size={14} />}
                size="sm"
                title={t('tools.revealInFm', { fileManager: fileManagerLabel() })}
                disabled={rootMissing || !root}
                onClick={() => {
                  const target = selectedPath || root
                  if (!target) return
                  void window.vav.conversations.revealInFinder(target)
                }}
              />
              {temporary && (
                <Button
                  icon={<FolderInput size={14} />}
                  size="sm"
                  title={t('files.locateTempDir')}
                  onClick={() => void locateWorkspace(activeId)}
                />
              )}
              <Button
                icon={<Info size={14} />}
                size="sm"
                title={t('files.ignoredTitle')}
                onClick={() =>
                  showDialog({
                    title: t('files.ignoredTitle'),
                    body: t('files.ignoredBody', {
                      list: [...IGNORED_NAMES, ...IGNORED_SUFFIXES].join('\n')
                    }),
                    confirmLabel: t('common.ok')
                  })
                }
              />
            </>
          )}
          {trayView === 'git' && gitChrome && (
            <>
              {gitChrome.meta ? <span className="git-panel-meta">{gitChrome.meta}</span> : null}
              <Button
                icon={<RefreshCw size={14} />}
                size="sm"
                className={`git-refresh-btn${gitChrome.loading ? ' is-refreshing' : ''}`}
                title={t('git.refresh')}
                disabled={gitChrome.loading}
                onClick={gitChrome.refresh}
              />
            </>
          )}
          {trayView === 'github' && githubChrome && (
            <>
              {githubChrome.meta ? (
                <span className="git-panel-meta">{githubChrome.meta}</span>
              ) : null}
              <Button
                icon={<RefreshCw size={14} />}
                size="sm"
                className={`git-refresh-btn${githubChrome.loading ? ' is-refreshing' : ''}`}
                title={t('github.refresh')}
                disabled={githubChrome.loading}
                onClick={githubChrome.refresh}
              />
            </>
          )}
          {trayView === 'supabase' && supabaseChrome && (
            <>
              {supabaseChrome.meta ? (
                <span className="git-panel-meta">{supabaseChrome.meta}</span>
              ) : null}
              <Button
                icon={<RefreshCw size={14} />}
                size="sm"
                className={`git-refresh-btn${supabaseChrome.loading ? ' is-refreshing' : ''}`}
                title={t('supabase.refresh')}
                disabled={supabaseChrome.loading}
                onClick={supabaseChrome.refresh}
              />
            </>
          )}
          {trayView === 'cloudflare' && cloudflareChrome && (
            <>
              {cloudflareChrome.meta ? (
                <span className="git-panel-meta">{cloudflareChrome.meta}</span>
              ) : null}
              <Button
                icon={<RefreshCw size={14} />}
                size="sm"
                className={`git-refresh-btn${cloudflareChrome.loading ? ' is-refreshing' : ''}`}
                title={t('cloudflare.refresh')}
                disabled={cloudflareChrome.loading}
                onClick={cloudflareChrome.refresh}
              />
            </>
          )}
        </div>
      </div>

      <div className="files-tray-stack">
        <div className="files-tray-pane" data-hidden={trayView !== 'files'}>
          <div
            className="files-browser"
            data-testid="files-panel"
            data-opaque={browserOpaque || undefined}
            tabIndex={trayView === 'files' ? 0 : -1}
            role="tree"
            aria-label={t('tools.files')}
            onMouseDown={() => setUiFocusScope('files')}
            onFocus={() => setUiFocusScope('files')}
          >
        {rootMissing ? (
          <div className="files-missing-root">
            <EmptyState
              title={t('sidebar.dirNotExist')}
              description={root || undefined}
            />
          </div>
        ) : displayMode === 'tree' ? (
          <div className="file-tree" onClick={() => selectPath(activeId, null, 'clear')}>
            {rootError ? (
              <InlineAlert kind="error" title={t('files.error.readDir')} message={rootError} />
            ) : (
              <TreeLevel
                path={root}
                level={0}
                onOpen={openViewer}
                onMutated={refreshParent}
                creating={creating}
                onCreatingChange={(name) =>
                  setCreating((c) => (c ? { ...c, name } : c))
                }
                onCreateCommit={() => void commitCreateFile(creating?.name ?? '')}
                onCreateCancel={cancelCreateFile}
              />
            )}
          </div>
        ) : (
          <ColumnBrowser
            root={root}
            columnPath={columnPath}
            setColumnPath={setColumnPath}
            onOpen={openViewer}
            onMutated={refreshParent}
            creating={creating}
            onCreatingChange={(name) => setCreating((c) => (c ? { ...c, name } : c))}
            onCreateCommit={() => void commitCreateFile(creating?.name ?? '')}
            onCreateCancel={cancelCreateFile}
          />
        )}
      </div>
        </div>
        <div className="files-tray-pane" data-hidden={trayView !== 'git'} data-testid="git-panel">
          <GitChangesPanel
            visible={visible}
            active={trayView === 'git'}
            isRepo={rootIsGit}
            onChrome={onGitChrome}
          />
        </div>
        {githubTrayOn && rootIsGit === true ? (
          <div className="files-tray-pane" data-hidden={trayView !== 'github'}>
            <GithubPanel visible={visible && trayView === 'github'} onChrome={onGithubChrome} />
          </div>
        ) : null}
        {supabaseTrayOn && hasSupabase === true ? (
          <div className="files-tray-pane" data-hidden={trayView !== 'supabase'}>
            <SupabasePanel
              visible={visible && trayView === 'supabase'}
              onChrome={onSupabaseChrome}
            />
          </div>
        ) : null}
        {cloudflareTrayOn && hasCloudflare ? (
          <div className="files-tray-pane" data-hidden={trayView !== 'cloudflare'}>
            <CloudflarePanel
              visible={visible && trayView === 'cloudflare'}
              onChrome={onCloudflareChrome}
            />
          </div>
        ) : null}
      </div>
    </>
  )
}
