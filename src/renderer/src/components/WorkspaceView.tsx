import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, File as FileIcon, Folder, Plus } from 'lucide-react'
import type { FileEntry } from '@shared/types'
import { useSessionStore } from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { useT } from '../i18n/useT'
import { basename } from '../lib/path'
import { Button, EmptyState } from './ui'
import { FileViewer } from './FileViewer'
import { SessionDetail } from './SessionDetail'

/**
 * Workspace View (workspace-view.rpml): tree + embedded preview + workspace Agent.
 */
export function WorkspaceView({ workdir }: { workdir: string }): React.JSX.Element {
  const t = useT()
  const activeId = useSessionStore((s) => s.activeId)
  const createConversation = useSessionStore((s) => s.createConversation)
  const workspace = useWorkspaceStore((s) => s.workspaces[activeId])
  const ensureFilesLoaded = useWorkspaceStore((s) => s.ensureFilesLoaded)
  const loadDirectory = useWorkspaceStore((s) => s.loadDirectory)
  const toggleExpand = useWorkspaceStore((s) => s.toggleExpand)
  const selectPath = useWorkspaceStore((s) => s.selectPath)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    if (activeId) void ensureFilesLoaded(activeId)
  }, [activeId, ensureFilesLoaded, workdir])

  const selectedPath = workspace?.selectedPath ?? null
  const root = workspace?.root ?? workdir
  const folderName = basename(workdir) || workdir

  const newSession = async (): Promise<void> => {
    await createConversation({ workingDirectory: workdir })
  }

  return (
    <div className="workspace-view">
      <aside className="workspace-view-tree">
        <div className="workspace-view-tree-head">
          <div className="workspace-view-title" title={workdir}>
            {folderName}
          </div>
          <input
            className="text-field"
            value={filter}
            placeholder={t('common.search')}
            onChange={(event) => setFilter(event.target.value)}
          />
        </div>
        <div className="workspace-view-tree-body">
          {!workspace && <div className="workspace-view-tree-empty muted">{t('common.loading')}</div>}
          {workspace && (
            <WorkspaceTree
              root={root}
              filter={filter.trim().toLowerCase()}
              selectedPath={selectedPath}
              onSelect={(path, isDir) => {
                if (isDir) {
                  void toggleExpand(activeId, path)
                  return
                }
                selectPath(activeId, path)
              }}
              onOpenPreview={(path) => {
                void window.vav.window.openFilePreview(path, {
                  origin: 'session',
                  conversationId: activeId
                })
              }}
              onExpand={(path) => void loadDirectory(activeId, path)}
            />
          )}
        </div>
      </aside>

      <section className="workspace-view-preview">
        {selectedPath ? (
          <FileViewer
            path={selectedPath}
            origin="session"
            parentConversationId={activeId}
            embedded
          />
        ) : (
          <EmptyState title={t('workspace.selectFile')} description={t('workspace.selectFileDesc')} />
        )}
      </section>

      <aside className="workspace-view-agent">
        <div className="workspace-view-agent-head">
          <div className="workspace-view-agent-head-row">
            <Folder size={14} className="workspace-view-agent-icon" aria-hidden />
            <span className="workspace-view-title" title={workdir}>
              {folderName}
            </span>
          </div>
          <div className="workspace-view-agent-head-row workspace-view-agent-session">
            <span className="workspace-view-agent-session-label">{t('common.session')}</span>
            <span className="spacer" />
            <Button
              label={t('workspace.newSession')}
              variant="secondary"
              size="sm"
              icon={<Plus size={12} />}
              onClick={() => void newSession()}
            />
          </div>
        </div>
        <SessionDetail variant="preview-edit" />
      </aside>
    </div>
  )
}

function WorkspaceTree({
  root,
  filter,
  selectedPath,
  onSelect,
  onOpenPreview,
  onExpand
}: {
  root: string
  filter: string
  selectedPath: string | null
  onSelect: (path: string, isDir: boolean) => void
  onOpenPreview: (path: string) => void
  onExpand: (path: string) => void
}): React.JSX.Element {
  const t = useT()
  const activeId = useSessionStore((s) => s.activeId)
  const workspace = useWorkspaceStore((s) => s.workspaces[activeId])
  const dirs = workspace?.dirs ?? {}
  const expanded = new Set(workspace?.expanded ?? [])
  const rootError = workspace?.dirErrors[root]

  if (rootError) {
    return <div className="workspace-view-tree-empty muted">{rootError}</div>
  }

  const entries = dirs[root] ?? []
  const loading = workspace?.loadingDirs.includes(root)
  if (!loading && entries.length === 0) {
    return <div className="workspace-view-tree-empty muted">{t('workspace.emptyDir')}</div>
  }

  return (
    <div>
      {entries.map((entry) => (
        <TreeNode
          key={entry.path}
          entry={entry}
          depth={0}
          filter={filter}
          selectedPath={selectedPath}
          expanded={expanded}
          dirs={dirs}
          onSelect={onSelect}
          onOpenPreview={onOpenPreview}
          onExpand={onExpand}
        />
      ))}
    </div>
  )
}

function TreeNode({
  entry,
  depth,
  filter,
  selectedPath,
  expanded,
  dirs,
  onSelect,
  onOpenPreview,
  onExpand
}: {
  entry: FileEntry
  depth: number
  filter: string
  selectedPath: string | null
  expanded: Set<string>
  dirs: Record<string, FileEntry[]>
  onSelect: (path: string, isDir: boolean) => void
  onOpenPreview: (path: string) => void
  onExpand: (path: string) => void
}): React.JSX.Element | null {
  const isDir = entry.isDirectory
  const open = expanded.has(entry.path)
  const name = basename(entry.path)
  const matches = !filter || name.toLowerCase().includes(filter)
  const children = isDir ? (dirs[entry.path] ?? []) : []

  if (!matches && !isDir) return null
  if (!matches && isDir && filter) {
    const anyChild = children.some((c) => basename(c.path).toLowerCase().includes(filter))
    if (!anyChild && !open) return null
  }

  return (
    <>
      <button
        type="button"
        className={`workspace-tree-row${selectedPath === entry.path ? ' selected' : ''}`}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => {
          if (isDir && !open) onExpand(entry.path)
          onSelect(entry.path, isDir)
        }}
        onDoubleClick={() => {
          if (!isDir) onOpenPreview(entry.path)
        }}
      >
        {isDir ? (
          open ? <ChevronDown size={12} /> : <ChevronRight size={12} />
        ) : (
          <span style={{ width: 12 }} />
        )}
        {isDir ? <Folder size={12} /> : <FileIcon size={12} />}
        <span className="label">{name}</span>
      </button>
      {isDir &&
        open &&
        children.map((child) => (
          <TreeNode
            key={child.path}
            entry={child}
            depth={depth + 1}
            filter={filter}
            selectedPath={selectedPath}
            expanded={expanded}
            dirs={dirs}
            onSelect={onSelect}
            onOpenPreview={onOpenPreview}
            onExpand={onExpand}
          />
        ))}
    </>
  )
}
