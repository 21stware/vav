import type { ConversationMeta } from '@shared/types'
import { useSessionStore } from '../state/sessionStore'
import { useT } from '../i18n/useT'
import { lucideMenuIcon } from './menuIcons'
import type { MenuItem } from './nativeMenu'

export { appObjectPointerHandlers, menuPoint } from './appObjectList'

export function useAppObjectConversationMenu(): {
  menuFor: (rows: ConversationMeta | ConversationMeta[], extra?: MenuItem[]) => MenuItem[]
  renamingId: string | null
  beginRename: (id: string | null) => void
  renameConversation: (id: string, title: string) => Promise<void>
  requestDelete: (ids: string[]) => void
} {
  const t = useT()
  const beginRename = useSessionStore((s) => s.beginRename)
  const renameConversation = useSessionStore((s) => s.renameConversation)
  const setArchived = useSessionStore((s) => s.setArchived)
  const requestDelete = useSessionStore((s) => s.requestDelete)
  const renamingId = useSessionStore((s) => s.renamingId)

  const menuFor = (
    rows: ConversationMeta | ConversationMeta[],
    extra: MenuItem[] = []
  ): MenuItem[] => {
    const targets = Array.isArray(rows) ? rows : [rows]
    if (targets.length === 0) return []
    if (targets.length > 1) {
      const allArchived = targets.every((row) => row.archived)
      return [
        {
          label: allArchived
            ? t('sidebar.menu.unarchiveCount', { count: targets.length })
            : t('sidebar.menu.archiveCount', { count: targets.length }),
          onSelect: () => {
            void (async () => {
              for (const row of targets) await setArchived(row.id, !allArchived)
            })()
          }
        },
        { label: '', divider: true },
        {
          label: t('sidebar.menu.deleteCount', { count: targets.length }),
          icon: lucideMenuIcon('trash-2'),
          destructive: true,
          onSelect: () => requestDelete(targets.map((row) => row.id))
        }
      ]
    }
    const row = targets[0]!
    const items: MenuItem[] = [
      {
        label: t('sidebar.menu.rename'),
        icon: lucideMenuIcon('pencil'),
        onSelect: () => beginRename(row.id)
      },
      {
        label: row.archived ? t('sidebar.menu.unarchive') : t('sidebar.menu.archive'),
        onSelect: () => void setArchived(row.id, !row.archived)
      }
    ]
    if (extra.length > 0) items.push({ label: '', divider: true }, ...extra)
    items.push(
      { label: '', divider: true },
      {
        label: t('sidebar.menu.delete'),
        icon: lucideMenuIcon('trash-2'),
        destructive: true,
        onSelect: () => requestDelete([row.id])
      }
    )
    return items
  }

  return { menuFor, renamingId, beginRename, renameConversation, requestDelete }
}
