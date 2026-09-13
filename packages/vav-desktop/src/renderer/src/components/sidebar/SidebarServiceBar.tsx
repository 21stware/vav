import { ChevronDown, House, Monitor } from 'lucide-react'
import { isLocalMachine, listedServices, normalizeMachineId } from '@shared/workspaceHost'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'
import { menuAnchor, showMenu, type MenuItem } from '../../lib/nativeMenu'
import { lucideMenuIcon } from '../../lib/menuIcons'

export function SidebarServiceBar({
  sessionMenuItems = []
}: {
  /** Session-management actions folded into the active service's menu. */
  sessionMenuItems?: MenuItem[]
} = {}): React.JSX.Element {
  const t = useT()
  const hosts = useSessionStore((s) => s.hosts)
  const services = listedServices(hosts)
  const windowMachineId = normalizeMachineId(useSessionStore((s) => s.windowMachineId))
  const defaultMachineId = normalizeMachineId(useSessionStore((s) => s.settings.defaultMachineId))
  const setDefaultMachine = useSessionStore((s) => s.setDefaultMachine)
  const incomingControllers = useSessionStore((s) => s.incomingControllers)
  const remoteControlStatus = useSessionStore((s) => s.remoteControlStatus)
  const incoming =
    incomingControllers.some((row) => row.online) || (remoteControlStatus?.clients.length ?? 0) > 0

  const switchService = (machineId: string): void => {
    void (async () => {
      await useSessionStore.getState().switchMachine(machineId)
      await window.vav.hosts.show(machineId)
    })()
  }

  const openMore = (machineId: string, anchor: HTMLElement): void => {
    const items: MenuItem[] = [
      {
        label: t('sidebar.setDefaultService'),
        checked: defaultMachineId === machineId,
        onSelect: () => void setDefaultMachine(machineId)
      },
      {
        label: t('sidebar.pairDevice'),
        onSelect: () => useSessionStore.getState().openSettings('connect', undefined, machineId)
      },
      {
        label: t('sidebar.configureService'),
        icon: lucideMenuIcon('settings'),
        onSelect: () => useSessionStore.getState().openSettings('agents', undefined, machineId)
      }
    ]
    if (!isLocalMachine(machineId)) {
      items.push({
        label: t('machines.forget'),
        onSelect: () => void window.vav.hosts.forget(machineId)
      })
    }
    // Import belongs to the active service, not a separate fixed button.
    if (sessionMenuItems.length) {
      items.push({ label: '', divider: true }, ...sessionMenuItems)
    }
    items.push(
      { label: '', divider: true },
      {
        label: t('common.settingsEllipsis'),
        icon: lucideMenuIcon('settings'),
        onSelect: () => useSessionStore.getState().openSettings('appearance', undefined, machineId)
      },
      {
        label: t('sidebar.pictureInPicture'),
        icon: lucideMenuIcon('picture-in-picture'),
        onSelect: () => void useSessionStore.getState().setPictureInPicture(true)
      }
    )
    void showMenu(items, menuAnchor(anchor))
  }

  return (
    <div className="sidebar-service-bar" data-testid="sidebar-service-bar">
      {services.map((service) => {
        const expanded = service.id === windowMachineId
        const title = isLocalMachine(service.id)
          ? `${service.name}${incoming ? ` · ${t('sidebar.connect')}` : ''}`
          : service.name
        const Icon = isLocalMachine(service.id) ? House : Monitor
        return (
          <button
            key={service.id}
            type="button"
            className="sidebar-service-chip"
            data-expanded={expanded ? 'true' : 'false'}
            data-testid={expanded ? 'sidebar-connect' : 'sidebar-service-chip'}
            data-machine-id={service.id}
            title={title}
            aria-label={expanded ? t('sidebar.switchService') : title}
            aria-expanded={expanded}
            onClick={(event) => {
              if (expanded) openMore(service.id, event.currentTarget)
              else switchService(service.id)
            }}
          >
            <Icon size={14} aria-hidden />
            <span className="sidebar-service-label-clip" aria-hidden="true">
              <span className="sidebar-service-label-inner">
                <span className="sidebar-service-label">{service.name}</span>
                <ChevronDown className="sidebar-foot-connect-chevron" size={11} aria-hidden />
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
