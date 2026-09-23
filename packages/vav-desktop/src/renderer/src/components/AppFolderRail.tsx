import { useState, type DragEvent, type ReactNode } from 'react'
import { Folder, FolderPlus, Library } from 'lucide-react'
import { APP_FOLDER_ALL_ID, type AppFolder } from '@shared/appFolders'
import type { MessageKey } from '@shared/i18n'
import { useT } from '../i18n/useT'
import { showMenu } from '../lib/nativeMenu'
import { RenameField } from './sidebar/RenameField'

export function AppFolderRail({
  folders,
  allCount,
  counts,
  selectedId,
  renamingId,
  allLabelKey,
  dragType,
  testIdPrefix,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onBeginRename,
  onDropObjects,
  readDragIds
}: {
  folders: AppFolder[]
  allCount: number
  counts: Record<string, number>
  selectedId: string
  renamingId: string | null
  allLabelKey: MessageKey
  dragType: string
  testIdPrefix: string
  onSelect: (id: string) => void
  onCreate: () => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  onBeginRename: (id: string | null) => void
  onDropObjects: (folderId: string | null, objectIds: string[]) => void
  readDragIds: (transfer: DataTransfer) => string[]
}): React.JSX.Element {
  const t = useT()
  const [dropId, setDropId] = useState<string | null>(null)

  const acceptDrop = (event: DragEvent, id: string): void => {
    if (!event.dataTransfer.types.includes(dragType)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setDropId(id)
  }

  return (
    <nav className="knowledge-folder-rail" aria-label={t(allLabelKey)} data-testid={`${testIdPrefix}-folder-rail`}>
      <div className="knowledge-folder-list">
        <FolderRow
          id={APP_FOLDER_ALL_ID}
          name={t(allLabelKey)}
          count={allCount}
          active={selectedId === APP_FOLDER_ALL_ID}
          drop={dropId === APP_FOLDER_ALL_ID}
          testId={`${testIdPrefix}-folder-all`}
          icon={<Library size={14} strokeWidth={1.75} />}
          onSelect={() => onSelect(APP_FOLDER_ALL_ID)}
          onDragOver={(event) => acceptDrop(event, APP_FOLDER_ALL_ID)}
          onDragLeave={() => setDropId((cur) => (cur === APP_FOLDER_ALL_ID ? null : cur))}
          onDrop={(event) => {
            event.preventDefault()
            setDropId(null)
            const ids = readDragIds(event.dataTransfer)
            if (ids.length) onDropObjects(null, ids)
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
              testId={`${testIdPrefix}-folder`}
              icon={<Folder size={14} strokeWidth={1.75} />}
              onSelect={() => onSelect(folder.id)}
              onRename={() => onBeginRename(folder.id)}
              onDelete={() => onDelete(folder.id)}
              onDragOver={(event) => acceptDrop(event, folder.id)}
              onDragLeave={() => setDropId((cur) => (cur === folder.id ? null : cur))}
              onDrop={(event) => {
                event.preventDefault()
                setDropId(null)
                const ids = readDragIds(event.dataTransfer)
                if (ids.length) onDropObjects(folder.id, ids)
              }}
            />
          )
        )}
      </div>
      <button type="button" className="knowledge-folder-add" onClick={onCreate}>
        <FolderPlus size={14} strokeWidth={1.75} aria-hidden />
        <span>{t('app.folder.new')}</span>
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
  testId,
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
  testId: string
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
      data-testid={testId}
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
            { label: t('app.folder.rename'), onSelect: onRename },
            { label: t('app.folder.delete'), destructive: true, onSelect: onDelete }
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
