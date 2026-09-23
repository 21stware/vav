import { useState, type DragEvent, type ReactNode } from 'react'
import { Folder, FolderPlus, Library } from 'lucide-react'
import { KNOWLEDGE_ALL_NOTES_ID, type KnowledgeFolder } from '@shared/knowledge'
import { useT } from '../../i18n/useT'
import { showMenu } from '../../lib/nativeMenu'
import { RenameField } from '../sidebar/RenameField'

export const KNOWLEDGE_DRAG_TYPE = 'application/x-vav-knowledge'

export function readKnowledgeDrag(transfer: DataTransfer): string[] {
  const raw = transfer.getData(KNOWLEDGE_DRAG_TYPE)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : []
  } catch {
    return []
  }
}

export function KnowledgeFolderRail({
  folders,
  allCount,
  counts,
  selectedId,
  renamingId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onBeginRename,
  onDropNotes
}: {
  folders: KnowledgeFolder[]
  allCount: number
  counts: Record<string, number>
  selectedId: string
  renamingId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  onBeginRename: (id: string | null) => void
  onDropNotes: (folderId: string | null, hostIds: string[]) => void
}): React.JSX.Element {
  const t = useT()
  const [dropId, setDropId] = useState<string | null>(null)

  const acceptDrop = (event: DragEvent, id: string): void => {
    if (!event.dataTransfer.types.includes(KNOWLEDGE_DRAG_TYPE)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropId(id)
  }

  return (
    <nav className="knowledge-folder-rail" aria-label={t('knowledge.allNotes')} data-testid="knowledge-folder-rail">
      <div className="knowledge-folder-list">
        <FolderRow
          id={KNOWLEDGE_ALL_NOTES_ID}
          name={t('knowledge.allNotes')}
          count={allCount}
          active={selectedId === KNOWLEDGE_ALL_NOTES_ID}
          drop={dropId === KNOWLEDGE_ALL_NOTES_ID}
          icon={<Library size={14} strokeWidth={1.75} />}
          onSelect={() => onSelect(KNOWLEDGE_ALL_NOTES_ID)}
          onDragOver={(event) => acceptDrop(event, KNOWLEDGE_ALL_NOTES_ID)}
          onDragLeave={() => setDropId((cur) => (cur === KNOWLEDGE_ALL_NOTES_ID ? null : cur))}
          onDrop={(event) => {
            event.preventDefault()
            setDropId(null)
            const ids = readKnowledgeDrag(event.dataTransfer)
            if (ids.length) onDropNotes(null, ids)
          }}
        />
        {folders.map((folder) =>
          renamingId === folder.id ? (
            <div key={folder.id} className="knowledge-folder is-renaming">
              <RenameField
                initial={folder.name}
                onCommit={(next) => {
                  const name = next.trim()
                  if (name && name !== folder.name) onRename(folder.id, name)
                  else onBeginRename(null)
                }}
                onCancel={() => onBeginRename(null)}
              />
            </div>
          ) : (
            <FolderRow
              key={folder.id}
              id={folder.id}
              name={folder.name}
              count={counts[folder.id] ?? 0}
              active={selectedId === folder.id}
              drop={dropId === folder.id}
              icon={<Folder size={14} strokeWidth={1.75} />}
              onSelect={() => onSelect(folder.id)}
              onRename={() => onBeginRename(folder.id)}
              onDelete={() => onDelete(folder.id)}
              onDragOver={(event) => acceptDrop(event, folder.id)}
              onDragLeave={() => setDropId((cur) => (cur === folder.id ? null : cur))}
              onDrop={(event) => {
                event.preventDefault()
                setDropId(null)
                const ids = readKnowledgeDrag(event.dataTransfer)
                if (ids.length) onDropNotes(folder.id, ids)
              }}
            />
          )
        )}
      </div>
      <button type="button" className="knowledge-folder-add" onClick={onCreate}>
        <FolderPlus size={14} strokeWidth={1.75} aria-hidden />
        <span>{t('knowledge.newFolder')}</span>
      </button>
    </nav>
  )
}

function FolderRow({
  id,
  name,
  count,
  active,
  drop,
  icon,
  onSelect,
  onRename,
  onDelete,
  onDragOver,
  onDragLeave,
  onDrop
}: {
  id: string
  name: string
  count: number
  active: boolean
  drop: boolean
  icon: ReactNode
  onSelect: () => void
  onRename?: () => void
  onDelete?: () => void
  onDragOver: (event: DragEvent) => void
  onDragLeave: () => void
  onDrop: (event: DragEvent) => void
}): React.JSX.Element {
  const t = useT()
  return (
    <button
      type="button"
      className={`knowledge-folder${drop ? ' is-drop' : ''}`}
      data-testid={id === KNOWLEDGE_ALL_NOTES_ID ? 'knowledge-folder-all' : 'knowledge-folder'}
      data-active={active ? 'true' : 'false'}
      data-folder-id={id}
      onClick={onSelect}
      onDoubleClick={onRename}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onContextMenu={(event) => {
        event.preventDefault()
        if (!onRename || !onDelete) return
        void showMenu(
          [
            { label: t('knowledge.renameFolder'), onSelect: onRename },
            { label: t('knowledge.deleteFolder'), destructive: true, onSelect: onDelete }
          ],
          { x: event.clientX, y: event.clientY }
        )
      }}
    >
      <span className="knowledge-folder-icon" aria-hidden>
        {icon}
      </span>
      <span className="knowledge-folder-name">{name}</span>
      <span className="knowledge-folder-count">{count}</span>
    </button>
  )
}
