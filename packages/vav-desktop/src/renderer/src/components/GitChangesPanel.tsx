import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import {
  isGitBranchesPage,
  isGitLogPage,
  isGitSnapshot,
  isGitStashesPage,
  suggestWorktreePath,
  type GitBranchEntry,
  type GitChangeEntry,
  type GitCommitEntry,
  type GitSnapshot,
  type GitStashEntry,
  type GitTrayTab
} from '@shared/git'
import { useSessionStore } from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { useT, tt } from '../i18n/useT'
import { isTemporaryWorkspace, relativeTime, workdirShortLabel } from '../lib/format'
import { bumpGitRepoSync, useGitRepoSyncEpoch } from '../lib/gitRepoSync'
import { fileManagerLabel } from '../lib/platform'
import { dirname } from '../lib/path'
import { makeListKeyDown } from '../lib/githubPanelNav'
import { EnableVersionControlChrome } from './SessionWorkspaceChrome'
import { Button, EmptyState, Segmented } from './ui'
import { FileManagerIcon } from './FileManagerIcon'
import { addFilesToComposer } from '../lib/composerAttach'
import { showMenu, type MenuItem } from '../lib/nativeMenu'
import { GitDiffContent, GitPatchView } from './gitPanel/GitDiff'
import { GitRefList, type GitRefRow } from './gitPanel/GitRefList'

export { GitDiffPreview, GitPatchPreview } from './gitPanel/GitDiff'

function statusLetter(entry: GitChangeEntry): string {
  if (entry.status === 'untracked') return 'U'
  if (entry.status === 'conflict') return '!'
  if (entry.status === 'added') return 'A'
  if (entry.status === 'deleted') return 'D'
  if (entry.status === 'renamed') return 'R'
  if (entry.status === 'modified') return 'M'
  return entry.code.trim().slice(-1) || '?'
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

function branchTrackLabel(
  entry: GitBranchEntry,
  t: ReturnType<typeof useT>
): string | undefined {
  if (entry.ahead && entry.behind) return t('git.aheadBehind', { ahead: entry.ahead, behind: entry.behind })
  if (entry.ahead) return t('git.ahead', { n: entry.ahead })
  if (entry.behind) return t('git.behind', { n: entry.behind })
  return undefined
}

async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    /* ignore */
  }
}

function promptName(message: string): string | null {
  const name = window.prompt(message, '')
  if (name == null || !name.trim()) return null
  return name.trim()
}

export type GitPanelChrome = {
  meta: string | null
  loading: boolean
  refresh: () => void
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
  const showDialog = useSessionStore((s) => s.showDialog)
  const conversation = useSessionStore((s) => s.conversations.find((c) => c.id === s.activeId))
  const tmp = useSessionStore((s) => s.tmp)
  const root = useWorkspaceStore((s) => s.workspaces[activeId]?.root ?? null)
  const gitRepoEpoch = useGitRepoSyncEpoch()
  const cwd = conversation?.workingDirectory ?? root
  const temporary = isTemporaryWorkspace(cwd, tmp)

  const [tab, setTab] = useState<GitTrayTab>('workspace')
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

  const [commits, setCommits] = useState<GitCommitEntry[]>([])
  const [commitsError, setCommitsError] = useState<string | null>(null)
  const [commitsLoading, setCommitsLoading] = useState(false)
  const [commitsLoaded, setCommitsLoaded] = useState(false)
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null)
  const [commitFocus, setCommitFocus] = useState(0)
  const commitListRef = useRef<HTMLDivElement>(null)

  const [localBranches, setLocalBranches] = useState<GitBranchEntry[]>([])
  const [originBranches, setOriginBranches] = useState<GitBranchEntry[]>([])
  const [branchesError, setBranchesError] = useState<string | null>(null)
  const [branchesLoading, setBranchesLoading] = useState(false)
  const [branchesLoaded, setBranchesLoaded] = useState(false)
  const [selectedLocal, setSelectedLocal] = useState<string | null>(null)
  const [selectedOrigin, setSelectedOrigin] = useState<string | null>(null)
  const [localFocus, setLocalFocus] = useState(0)
  const [originFocus, setOriginFocus] = useState(0)
  const localListRef = useRef<HTMLDivElement>(null)
  const originListRef = useRef<HTMLDivElement>(null)

  const [stashes, setStashes] = useState<GitStashEntry[]>([])
  const [stashesError, setStashesError] = useState<string | null>(null)
  const [stashesLoading, setStashesLoading] = useState(false)
  const [stashesLoaded, setStashesLoaded] = useState(false)
  const [selectedStash, setSelectedStash] = useState<string | null>(null)
  const [stashFocus, setStashFocus] = useState(0)
  const stashListRef = useRef<HTMLDivElement>(null)

  const [patch, setPatch] = useState<string | null>(null)
  const [patchError, setPatchError] = useState<string | null>(null)

  const tree = useMemo(
    () => (snap?.isRepo ? buildChangeTree(snap.changes ?? []) : []),
    [snap]
  )

  useEffect(() => {
    if (!snap?.isRepo) return
    setExpanded(defaultExpanded(tree))
  }, [snap?.cwd, snap?.isRepo, tree])

  const rows = useMemo(() => flattenTree(tree, expanded), [tree, expanded])

  const selectedEntry = useMemo(
    () => snap?.changes?.find((c) => c.path === selected) ?? null,
    [snap, selected]
  )

  const selectedCommitEntry = useMemo(
    () => commits.find((c) => c.sha === selectedCommit) ?? null,
    [commits, selectedCommit]
  )
  const selectedLocalEntry = useMemo(
    () => localBranches.find((b) => b.name === selectedLocal) ?? null,
    [localBranches, selectedLocal]
  )
  const selectedOriginEntry = useMemo(
    () => originBranches.find((b) => b.fullName === selectedOrigin) ?? null,
    [originBranches, selectedOrigin]
  )
  const selectedStashEntry = useMemo(
    () => stashes.find((s) => String(s.index) === selectedStash) ?? null,
    [stashes, selectedStash]
  )

  const patchTarget = useMemo(() => {
    if (tab === 'commits' && selectedCommitEntry) {
      return { spec: selectedCommitEntry.sha, title: selectedCommitEntry.subject }
    }
    if (tab === 'local' && selectedLocalEntry) {
      return { spec: selectedLocalEntry.name, title: selectedLocalEntry.name }
    }
    if (tab === 'origin' && selectedOriginEntry) {
      return { spec: selectedOriginEntry.fullName, title: selectedOriginEntry.fullName }
    }
    if (tab === 'stashes' && selectedStashEntry) {
      return { spec: selectedStashEntry.selector, title: selectedStashEntry.subject }
    }
    return null
  }, [tab, selectedCommitEntry, selectedLocalEntry, selectedOriginEntry, selectedStashEntry])

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
      const next = await window.vav.git.status(root, activeId)
      if (!isGitSnapshot(next)) {
        setSnap(null)
        setLoadError(tt('git.apiMissing'))
        return
      }
      setSnap(next)
      const changes = next.changes ?? []
      setSelected((prev) => {
        if (prev && changes.some((c) => c.path === prev)) return prev
        return changes[0]?.path ?? null
      })
    } catch (err) {
      setSnap(null)
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [activeId, root, gitRepoEpoch])

  const refreshLog = useCallback(async (): Promise<void> => {
    if (!root || !window.vav?.git) {
      setCommits([])
      setCommitsLoaded(false)
      setCommitsError(window.vav?.git ? null : tt('git.apiMissing'))
      return
    }
    setCommitsLoading(true)
    setCommitsError(null)
    try {
      const result = await window.vav.git.log(root, { conversationId: activeId })
      if (!result.ok || !isGitLogPage(result.data)) {
        setCommits([])
        setCommitsError(result.ok ? tt('git.apiMissing') : result.error)
        setCommitsLoaded(true)
        return
      }
      setCommits(result.data.commits)
      setSelectedCommit((prev) => {
        if (prev && result.data.commits.some((c) => c.sha === prev)) return prev
        return result.data.commits[0]?.sha ?? null
      })
      setCommitsLoaded(true)
    } catch (err) {
      setCommits([])
      setCommitsError(err instanceof Error ? err.message : String(err))
      setCommitsLoaded(true)
    } finally {
      setCommitsLoading(false)
    }
  }, [activeId, root])

  const refreshBranches = useCallback(async (): Promise<void> => {
    if (!root || !window.vav?.git) {
      setLocalBranches([])
      setOriginBranches([])
      setBranchesLoaded(false)
      setBranchesError(window.vav?.git ? null : tt('git.apiMissing'))
      return
    }
    setBranchesLoading(true)
    setBranchesError(null)
    try {
      const result = await window.vav.git.branches(root, activeId)
      if (!result.ok || !isGitBranchesPage(result.data)) {
        setLocalBranches([])
        setOriginBranches([])
        setBranchesError(result.ok ? tt('git.apiMissing') : result.error)
        setBranchesLoaded(true)
        return
      }
      const origin = result.data.remote.filter((b) => b.remote === 'origin')
      const remote = origin.length ? origin : result.data.remote
      setLocalBranches(result.data.local)
      setOriginBranches(remote)
      setSelectedLocal((prev) => {
        if (prev && result.data.local.some((b) => b.name === prev)) return prev
        return result.data.local.find((b) => b.current)?.name ?? result.data.local[0]?.name ?? null
      })
      setSelectedOrigin((prev) => {
        if (prev && remote.some((b) => b.fullName === prev)) return prev
        return remote[0]?.fullName ?? null
      })
      setBranchesLoaded(true)
    } catch (err) {
      setLocalBranches([])
      setOriginBranches([])
      setBranchesError(err instanceof Error ? err.message : String(err))
      setBranchesLoaded(true)
    } finally {
      setBranchesLoading(false)
    }
  }, [activeId, root])

  const refreshStashes = useCallback(async (): Promise<void> => {
    if (!root || !window.vav?.git) {
      setStashes([])
      setStashesLoaded(false)
      setStashesError(window.vav?.git ? null : tt('git.apiMissing'))
      return
    }
    setStashesLoading(true)
    setStashesError(null)
    try {
      const result = await window.vav.git.stashes(root, activeId)
      if (!result.ok || !isGitStashesPage(result.data)) {
        setStashes([])
        setStashesError(result.ok ? tt('git.apiMissing') : result.error)
        setStashesLoaded(true)
        return
      }
      setStashes(result.data.stashes)
      setSelectedStash((prev) => {
        if (prev && result.data.stashes.some((s) => String(s.index) === prev)) return prev
        return result.data.stashes[0] ? String(result.data.stashes[0].index) : null
      })
      setStashesLoaded(true)
    } catch (err) {
      setStashes([])
      setStashesError(err instanceof Error ? err.message : String(err))
      setStashesLoaded(true)
    } finally {
      setStashesLoading(false)
    }
  }, [activeId, root])

  const refreshActive = useCallback((): void => {
    void refresh()
    if (tab === 'commits') void refreshLog()
    else if (tab === 'local' || tab === 'origin') void refreshBranches()
    else if (tab === 'stashes') void refreshStashes()
  }, [refresh, refreshLog, refreshBranches, refreshStashes, tab])

  const refreshRef = useRef(refreshActive)
  refreshRef.current = refreshActive
  const stableRefresh = useCallback(() => {
    refreshRef.current()
  }, [])

  useEffect(() => {
    if (!visible) return
    void refresh()
  }, [visible, refresh])

  useEffect(() => {
    if (!visible || !active || !snap?.isRepo) return
    if (tab === 'commits') void refreshLog()
    else if (tab === 'local' || tab === 'origin') void refreshBranches()
    else if (tab === 'stashes') void refreshStashes()
  }, [visible, active, snap?.isRepo, tab, refreshLog, refreshBranches, refreshStashes])

  const tabLoading =
    tab === 'workspace'
      ? loading
      : tab === 'commits'
        ? commitsLoading
        : tab === 'stashes'
          ? stashesLoading
          : branchesLoading

  const chromeMeta = useMemo(() => {
    if (!snap?.isRepo) return null
    const head = snap.branch || t('git.detached', { head: snap.headShort ?? '?' })
    if (tab === 'commits') return `${head} · ${t('git.commitCount', { n: commits.length })}`
    if (tab === 'local') return `${head} · ${t('git.branchCount', { n: localBranches.length })}`
    if (tab === 'origin') return `${head} · ${t('git.originCount', { n: originBranches.length })}`
    if (tab === 'stashes') return `${head} · ${t('git.stashCount', { n: stashes.length })}`
    return `${head} · ${t('git.changeCount', { n: snap.changes?.length ?? 0 })}`
  }, [snap, tab, commits.length, localBranches.length, originBranches.length, stashes.length, t])

  useEffect(() => {
    if (!onChrome) return
    if (!active || !visible || !root || !snap?.isRepo) {
      onChrome(null)
      return
    }
    onChrome({
      meta: chromeMeta,
      loading: tabLoading,
      refresh: stableRefresh
    })
  }, [onChrome, active, visible, root, snap, chromeMeta, tabLoading, stableRefresh])

  useEffect(() => {
    return () => onChrome?.(null)
  }, [onChrome])

  useEffect(() => {
    if (!active || !visible || !previewHost || !root) return
    if (!filePreviewOpen) return
    if (tab === 'workspace') {
      if (sessionPreview.kind !== 'git' || !selectedEntry) return
      setSessionPreview({ kind: 'git', cwd: root, entry: selectedEntry })
      return
    }
    if (sessionPreview.kind !== 'git-patch' || !patchTarget) return
    setSessionPreview({
      kind: 'git-patch',
      cwd: root,
      spec: patchTarget.spec,
      title: patchTarget.title
    })
  }, [
    active,
    visible,
    previewHost,
    root,
    tab,
    selectedEntry,
    patchTarget,
    filePreviewOpen,
    sessionPreview.kind,
    setSessionPreview
  ])

  useEffect(() => {
    if (previewHost || !active || !visible || !root || !selected || !snap?.isRepo || tab !== 'workspace') {
      if (tab !== 'workspace') {
        setDiff(null)
        setDiffError(null)
      }
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
        const result = await window.vav.git.diff(root, selected, {
          conversationId: activeId
        })
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
  }, [previewHost, active, visible, root, selected, snap?.isRepo, t, activeId, tab])

  useEffect(() => {
    if (previewHost || !active || !visible || !root || !patchTarget || tab === 'workspace') {
      if (tab === 'workspace') {
        setPatch(null)
        setPatchError(null)
      }
      return
    }
    if (!window.vav?.git?.patch) {
      setPatch(null)
      setPatchError(t('git.apiMissing'))
      return
    }
    let cancelled = false
    setPatch(null)
    setPatchError(null)
    void (async () => {
      try {
        const result = await window.vav.git.patch(root, patchTarget.spec, activeId)
        if (cancelled) return
        if (!result.ok) {
          setPatch(null)
          setPatchError(result.error)
          return
        }
        setPatchError(null)
        setPatch(result.data)
      } catch (err) {
        if (cancelled) return
        setPatch(null)
        setPatchError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [previewHost, active, visible, root, patchTarget, tab, t, activeId])

  useEffect(() => {
    if (!selected) return
    const idx = rows.findIndex((r) => r.kind === 'file' && r.path === selected)
    if (idx >= 0) setFocusIndex(idx)
  }, [selected, rows])

  const fail = useCallback(
    (title: string, error: string): void => {
      showDialog({ title, body: error, confirmLabel: t('common.ok') })
    },
    [showDialog, t]
  )

  const afterMutate = useCallback(async (): Promise<void> => {
    bumpGitRepoSync()
    await refresh()
    if (tab === 'commits') await refreshLog()
    else if (tab === 'local' || tab === 'origin') await refreshBranches()
    else if (tab === 'stashes') await refreshStashes()
  }, [refresh, refreshLog, refreshBranches, refreshStashes, tab])

  const checkoutRef = useCallback(
    async (name: string): Promise<void> => {
      if (!root || !window.vav?.git?.checkoutBranch) {
        fail(t('git.checkoutFailed'), t('git.apiMissing'))
        return
      }
      const result = await window.vav.git.checkoutBranch(root, name, activeId)
      if (!result.ok) {
        fail(t('git.checkoutFailed'), result.error)
        return
      }
      await afterMutate()
    },
    [root, activeId, afterMutate, fail, t]
  )

  const createBranch = useCallback(
    async (opts?: { startPoint?: string; checkout?: boolean }): Promise<void> => {
      if (!root || !window.vav?.git?.createBranch) {
        fail(t('git.createBranchFailed'), t('git.apiMissing'))
        return
      }
      const name = promptName(t('git.branchNamePlaceholder'))
      if (!name) return
      const result = await window.vav.git.createBranch(root, name, {
        checkout: opts?.checkout ?? true,
        startPoint: opts?.startPoint,
        conversationId: activeId
      })
      if (!result.ok) {
        fail(t('git.createBranchFailed'), result.error)
        return
      }
      await afterMutate()
    },
    [root, activeId, afterMutate, fail, t]
  )

  const createWorktree = useCallback(
    async (opts?: { existing?: string; startPoint?: string }): Promise<void> => {
      if (!root || !snap?.isRepo || !window.vav?.git?.createWorktree) {
        fail(t('git.createWorktreeFailed'), t('git.apiMissing'))
        return
      }
      const primary =
        snap.worktrees.find((w) => w.isPrimary)?.path ?? snap.toplevel ?? root
      const existing = opts?.existing?.trim()
      const startPoint = opts?.startPoint?.trim()
      const newBranch = existing ? undefined : promptName(t('git.newBranchPlaceholder'))
      if (!existing && !newBranch) return
      const name = existing || newBranch!
      const path = suggestWorktreePath(primary, name)
      const result = await window.vav.git.createWorktree(
        root,
        existing
          ? { path, branch: existing }
          : { path, newBranch: name, branch: startPoint || undefined },
        activeId
      )
      if (!result.ok) {
        fail(t('git.createWorktreeFailed'), result.error)
        return
      }
      await afterMutate()
    },
    [root, snap, activeId, afterMutate, fail, t]
  )

  const deleteBranch = useCallback(
    (name: string): void => {
      if (!root || !window.vav?.git?.deleteBranch) {
        fail(t('git.deleteBranchFailed'), t('git.apiMissing'))
        return
      }
      showDialog({
        title: t('git.deleteBranch'),
        body: t('git.deleteBranchConfirm', { name }),
        confirmLabel: t('common.delete'),
        cancelLabel: t('common.cancel'),
        destructive: true,
        onConfirm: () => {
          void (async () => {
            const result = await window.vav.git.deleteBranch(root, name, activeId)
            if (!result.ok) {
              fail(t('git.deleteBranchFailed'), result.error)
              return
            }
            await afterMutate()
          })()
        }
      })
    },
    [root, activeId, afterMutate, fail, showDialog, t]
  )

  const stashPush = useCallback(async (): Promise<void> => {
    if (!root || !window.vav?.git?.stashPush) {
      fail(t('git.stashFailed'), t('git.apiMissing'))
      return
    }
    const result = await window.vav.git.stashPush(root, { conversationId: activeId })
    if (!result.ok) {
      fail(t('git.stashFailed'), result.error)
      return
    }
    await afterMutate()
  }, [root, activeId, afterMutate, fail, t])

  const stashAct = useCallback(
    (index: number, kind: 'apply' | 'pop' | 'drop'): void => {
      if (!root) return
      const run = async (): Promise<void> => {
        if (kind === 'drop') {
          if (!window.vav?.git?.stashDrop) {
            fail(t('git.stashFailed'), t('git.apiMissing'))
            return
          }
          const result = await window.vav.git.stashDrop(root, index, activeId)
          if (!result.ok) fail(t('git.stashFailed'), result.error)
          else await afterMutate()
          return
        }
        if (!window.vav?.git?.stashApply) {
          fail(t('git.stashFailed'), t('git.apiMissing'))
          return
        }
        const result = await window.vav.git.stashApply(root, index, {
          pop: kind === 'pop',
          conversationId: activeId
        })
        if (!result.ok) fail(t('git.stashFailed'), result.error)
        else await afterMutate()
      }
      if (kind === 'apply') {
        void run()
        return
      }
      const stash = stashes.find((s) => s.index === index)
      const name = stash?.selector ?? `stash@{${index}}`
      showDialog({
        title: kind === 'pop' ? t('git.stashPop') : t('git.stashDrop'),
        body: kind === 'pop' ? t('git.stashPopConfirm', { name }) : t('git.stashDropConfirm', { name }),
        confirmLabel: kind === 'pop' ? t('git.stashPop') : t('common.delete'),
        cancelLabel: t('common.cancel'),
        destructive: kind === 'drop',
        onConfirm: () => void run()
      })
    },
    [root, activeId, afterMutate, fail, showDialog, stashes, t]
  )

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
      const result = await window.vav.git.init(cwd, activeId)
      if (!result?.ok) {
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
  }, [cwd, activeId, refresh, t])

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

  const previewPatch = (spec: string, title: string): void => {
    if (!root) return
    setSessionPreview({ kind: 'git-patch', cwd: root, spec, title })
    setFilePreviewOpen(true)
  }

  const showGitEntryMenu = (entry: GitChangeEntry, x: number, y: number): void => {
    const revealTarget =
      entry.status === 'deleted' ? dirname(entry.absolutePath) : entry.absolutePath
    const items: MenuItem[] = [
      ...(entry.status === 'deleted'
        ? []
        : [
            {
              label: t('files.addToComposer'),
              onSelect: () => addFilesToComposer([entry.absolutePath])
            }
          ]),
      { label: t('common.preview'), onSelect: () => previewGitEntry(entry) },
      {
        label: t('git.revealInFm', { fileManager: fileManagerLabel() }),
        onSelect: () => void window.vav.conversations.revealInFinder(revealTarget)
      },
      { label: t('git.copyPath'), onSelect: () => void copyText(entry.path) }
    ]
    void showMenu(items, { x, y })
  }

  const showCommitMenu = (commit: GitCommitEntry, x: number, y: number): void => {
    const items: MenuItem[] = [
      { label: t('common.preview'), onSelect: () => previewPatch(commit.sha, commit.subject) },
      { label: t('git.copySha'), onSelect: () => void copyText(commit.sha) },
      {
        label: t('git.createBranchFrom'),
        onSelect: () => void createBranch({ startPoint: commit.sha, checkout: false })
      },
      {
        label: t('git.checkoutCommit'),
        onSelect: () => {
          showDialog({
            title: t('git.checkoutCommit'),
            body: t('git.checkoutCommitDesc', { sha: commit.shortSha }),
            confirmLabel: t('git.checkout'),
            cancelLabel: t('common.cancel'),
            onConfirm: () => void checkoutRef(commit.sha)
          })
        }
      }
    ]
    void showMenu(items, { x, y })
  }

  const showLocalMenu = (branch: GitBranchEntry, x: number, y: number): void => {
    const items: MenuItem[] = [
      { label: t('common.preview'), onSelect: () => previewPatch(branch.name, branch.name) },
      {
        label: t('git.checkout'),
        disabled: branch.current,
        onSelect: () => void checkoutRef(branch.name)
      },
      {
        label: t('git.createBranchFrom'),
        onSelect: () => void createBranch({ startPoint: branch.name, checkout: false })
      },
      {
        label: t('git.createWorktree'),
        onSelect: () => void createWorktree({ existing: branch.name })
      },
      { label: t('git.copyName'), onSelect: () => void copyText(branch.name) },
      { label: '', divider: true },
      {
        label: t('git.deleteBranch'),
        disabled: branch.current,
        destructive: true,
        onSelect: () => deleteBranch(branch.name)
      }
    ]
    void showMenu(items, { x, y })
  }

  const showOriginMenu = (branch: GitBranchEntry, x: number, y: number): void => {
    const items: MenuItem[] = [
      {
        label: t('common.preview'),
        onSelect: () => previewPatch(branch.fullName, branch.fullName)
      },
      { label: t('git.checkout'), onSelect: () => void checkoutRef(branch.fullName) },
      {
        label: t('git.createBranchFrom'),
        onSelect: () => void createBranch({ startPoint: branch.fullName, checkout: false })
      },
      {
        label: t('git.createWorktree'),
        onSelect: () => void createWorktree({ startPoint: branch.fullName })
      },
      { label: t('git.copyName'), onSelect: () => void copyText(branch.fullName) }
    ]
    void showMenu(items, { x, y })
  }

  const showStashMenu = (stash: GitStashEntry, x: number, y: number): void => {
    const items: MenuItem[] = [
      { label: t('common.preview'), onSelect: () => previewPatch(stash.selector, stash.subject) },
      { label: t('git.stashApply'), onSelect: () => stashAct(stash.index, 'apply') },
      { label: t('git.stashPop'), onSelect: () => stashAct(stash.index, 'pop') },
      { label: '', divider: true },
      {
        label: t('git.stashDrop'),
        destructive: true,
        onSelect: () => stashAct(stash.index, 'drop')
      }
    ]
    void showMenu(items, { x, y })
  }

  const showWorkspaceBackgroundMenu = (x: number, y: number): void => {
    const dirty = (snap?.changes?.length ?? 0) > 0
    void showMenu(
      [
        { label: t('git.createBranch'), onSelect: () => void createBranch({ checkout: true }) },
        { label: t('git.createWorktree'), onSelect: () => void createWorktree() },
        { label: '', divider: true },
        {
          label: t('git.stashPush'),
          disabled: !dirty,
          onSelect: () => void stashPush()
        }
      ],
      { x, y }
    )
  }

  const showLocalBackgroundMenu = (x: number, y: number): void => {
    void showMenu(
      [
        { label: t('git.createBranch'), onSelect: () => void createBranch({ checkout: true }) },
        { label: t('git.createWorktree'), onSelect: () => void createWorktree() }
      ],
      { x, y }
    )
  }

  const showStashBackgroundMenu = (x: number, y: number): void => {
    void showMenu([{ label: t('git.stashPush'), onSelect: () => void stashPush() }], { x, y })
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

  const commitRows: GitRefRow[] = commits.map((c) => ({
    id: c.sha,
    title: c.subject || c.shortSha,
    sha: c.shortSha,
    meta: relativeTime(c.date)
  }))
  const localRows: GitRefRow[] = localBranches.map((b) => ({
    id: b.name,
    title: b.name,
    sha: b.shortSha,
    current: b.current,
    track: branchTrackLabel(b, t),
    meta: relativeTime(b.date)
  }))
  const originRows: GitRefRow[] = originBranches.map((b) => ({
    id: b.fullName,
    title: b.fullName,
    sha: b.shortSha,
    track: branchTrackLabel(b, t),
    meta: relativeTime(b.date)
  }))
  const stashRows: GitRefRow[] = stashes.map((s) => ({
    id: String(s.index),
    title: s.subject || s.selector,
    sha: s.selector,
    meta: relativeTime(s.date)
  }))

  const onCommitKeyDown = makeListKeyDown({
    count: commits.length,
    setIndex: setCommitFocus,
    selectAt: (index) => {
      const row = commits[index]
      if (row) setSelectedCommit(row.sha)
    },
    previewAt: (index) => {
      const row = commits[index]
      if (row) previewPatch(row.sha, row.subject)
    },
    scrollParent: commitListRef,
    rowAttr: 'data-git-commit-row'
  })
  const onLocalKeyDown = makeListKeyDown({
    count: localBranches.length,
    setIndex: setLocalFocus,
    selectAt: (index) => {
      const row = localBranches[index]
      if (row) setSelectedLocal(row.name)
    },
    previewAt: (index) => {
      const row = localBranches[index]
      if (row) previewPatch(row.name, row.name)
    },
    scrollParent: localListRef,
    rowAttr: 'data-git-local-row'
  })
  const onOriginKeyDown = makeListKeyDown({
    count: originBranches.length,
    setIndex: setOriginFocus,
    selectAt: (index) => {
      const row = originBranches[index]
      if (row) setSelectedOrigin(row.fullName)
    },
    previewAt: (index) => {
      const row = originBranches[index]
      if (row) previewPatch(row.fullName, row.fullName)
    },
    scrollParent: originListRef,
    rowAttr: 'data-git-origin-row'
  })
  const onStashKeyDown = makeListKeyDown({
    count: stashes.length,
    setIndex: setStashFocus,
    selectAt: (index) => {
      const row = stashes[index]
      if (row) setSelectedStash(String(row.index))
    },
    previewAt: (index) => {
      const row = stashes[index]
      if (row) previewPatch(row.selector, row.subject)
    },
    scrollParent: stashListRef,
    rowAttr: 'data-git-stash-row'
  })

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

  const tabs = (
    <div className="git-filter" data-testid="git-subtabs">
      <Segmented<GitTrayTab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'workspace', label: t('git.tabWorkspace'), title: t('git.tabWorkspace') },
          { value: 'commits', label: t('git.tabCommits'), title: t('git.tabCommits') },
          { value: 'local', label: t('git.tabLocal'), title: t('git.tabLocal') },
          { value: 'origin', label: t('git.tabOrigin'), title: t('git.tabOrigin') },
          { value: 'stashes', label: t('git.tabStashes'), title: t('git.tabStashes') }
        ]}
      />
    </div>
  )

  const patchPane = (emptyHint: string): React.JSX.Element | null => {
    if (previewHost) return null
    return (
      <div className="git-diff-pane">
        {patchTarget ? (
          <>
            <div className="git-diff-header">
              <span className="git-diff-filename" title={patchTarget.title}>
                {patchTarget.title}
              </span>
            </div>
            <GitPatchView text={patch} error={patchError} spec={patchTarget.spec} />
          </>
        ) : (
          <div className="git-detail-empty">{emptyHint}</div>
        )}
      </div>
    )
  }

  return (
    <div className="git-panel">
      {tabs}
      {tab === 'workspace' ? (
        !(snap.changes?.length) ? (
          <div
            className="git-ref-empty"
            onContextMenu={(event) => {
              event.preventDefault()
              event.stopPropagation()
              showWorkspaceBackgroundMenu(event.clientX, event.clientY)
            }}
          >
            <EmptyState title={t('git.clean')} description={t('git.cleanDesc')} />
          </div>
        ) : (
          <div className={`git-panel-body${previewHost ? ' is-list-only' : ''}`}>
            <div
              ref={listRef}
              className="git-change-list"
              role="tree"
              tabIndex={0}
              aria-label={t('git.changes')}
              onKeyDown={onListKeyDown}
              onContextMenu={(event) => {
                if ((event.target as HTMLElement).closest('.git-change-row')) return
                event.preventDefault()
                event.stopPropagation()
                showWorkspaceBackgroundMenu(event.clientX, event.clientY)
              }}
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
        )
      ) : tab === 'commits' ? (
        <div className={`git-panel-body${previewHost ? ' is-list-only' : ''}`}>
          <div className="git-list-pane">
            <GitRefList
              rows={commitRows}
              selectedId={selectedCommit}
              focusIndex={commitFocus}
              loading={commitsLoading}
              error={commitsError}
              loaded={commitsLoaded}
              emptyTitle={t('git.noCommits')}
              emptyDesc={t('git.noCommitsDesc')}
              listRef={commitListRef}
              onKeyDown={onCommitKeyDown}
              onSelect={(index, id) => {
                setCommitFocus(index)
                setSelectedCommit(id)
              }}
              onPreview={(id) => {
                const row = commits.find((c) => c.sha === id)
                if (row) previewPatch(row.sha, row.subject)
              }}
              onMenu={(id, x, y) => {
                const row = commits.find((c) => c.sha === id)
                if (row) showCommitMenu(row, x, y)
              }}
              rowAttr="data-git-commit-row"
              testId="git-commit-list"
              ariaLabel={t('git.tabCommits')}
            />
          </div>
          {patchPane(t('git.selectCommit'))}
        </div>
      ) : tab === 'local' ? (
        <div className={`git-panel-body${previewHost ? ' is-list-only' : ''}`}>
          <div className="git-list-pane">
            <GitRefList
              rows={localRows}
              selectedId={selectedLocal}
              focusIndex={localFocus}
              loading={branchesLoading}
              error={branchesError}
              loaded={branchesLoaded}
              emptyTitle={t('git.noBranches')}
              emptyDesc={t('git.noBranchesDesc')}
              listRef={localListRef}
              onKeyDown={onLocalKeyDown}
              onSelect={(index, id) => {
                setLocalFocus(index)
                setSelectedLocal(id)
              }}
              onPreview={(id) => previewPatch(id, id)}
              onMenu={(id, x, y) => {
                const row = localBranches.find((b) => b.name === id)
                if (row) showLocalMenu(row, x, y)
              }}
              onBackgroundMenu={showLocalBackgroundMenu}
              rowAttr="data-git-local-row"
              testId="git-local-list"
              ariaLabel={t('git.tabLocal')}
            />
          </div>
          {patchPane(t('git.selectBranch'))}
        </div>
      ) : tab === 'origin' ? (
        <div className={`git-panel-body${previewHost ? ' is-list-only' : ''}`}>
          <div className="git-list-pane">
            <GitRefList
              rows={originRows}
              selectedId={selectedOrigin}
              focusIndex={originFocus}
              loading={branchesLoading}
              error={branchesError}
              loaded={branchesLoaded}
              emptyTitle={t('git.noOrigin')}
              emptyDesc={t('git.noOriginDesc')}
              listRef={originListRef}
              onKeyDown={onOriginKeyDown}
              onSelect={(index, id) => {
                setOriginFocus(index)
                setSelectedOrigin(id)
              }}
              onPreview={(id) => previewPatch(id, id)}
              onMenu={(id, x, y) => {
                const row = originBranches.find((b) => b.fullName === id)
                if (row) showOriginMenu(row, x, y)
              }}
              rowAttr="data-git-origin-row"
              testId="git-origin-list"
              ariaLabel={t('git.tabOrigin')}
            />
          </div>
          {patchPane(t('git.selectBranch'))}
        </div>
      ) : (
        <div className={`git-panel-body${previewHost ? ' is-list-only' : ''}`}>
          <div className="git-list-pane">
            <GitRefList
              rows={stashRows}
              selectedId={selectedStash}
              focusIndex={stashFocus}
              loading={stashesLoading}
              error={stashesError}
              loaded={stashesLoaded}
              emptyTitle={t('git.noStashes')}
              emptyDesc={t('git.noStashesDesc')}
              listRef={stashListRef}
              onKeyDown={onStashKeyDown}
              onSelect={(index, id) => {
                setStashFocus(index)
                setSelectedStash(id)
              }}
              onPreview={(id) => {
                const row = stashes.find((s) => String(s.index) === id)
                if (row) previewPatch(row.selector, row.subject)
              }}
              onMenu={(id, x, y) => {
                const row = stashes.find((s) => String(s.index) === id)
                if (row) showStashMenu(row, x, y)
              }}
              onBackgroundMenu={showStashBackgroundMenu}
              rowAttr="data-git-stash-row"
              testId="git-stash-list"
              ariaLabel={t('git.tabStashes')}
            />
          </div>
          {patchPane(t('git.selectStash'))}
        </div>
      )}
    </div>
  )
}
