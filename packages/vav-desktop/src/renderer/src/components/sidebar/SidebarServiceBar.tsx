import { ChevronDown, House, Monitor, Smartphone } from 'lucide-react'
import { isLocalMachine, listedServices, normalizeMachineId } from '@shared/workspaceHost'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'
import { menuAnchor, showMenu, type MenuItem } from '../../lib/nativeMenu'
import { lucideMenuIcon } from '../../lib/menuIcons'

export function SidebarServiceBar({
  sessionMenuItems = [],
  variant = 'instance',
  label,
  testId = 'sidebar-connect',
  onOpen
}: {
  /** Session-management actions folded into the active service's menu. */
  sessionMenuItems?: MenuItem[]
  variant?: 'instance' | 'nav'
  label?: string
  testId?: string
  onOpen?: () => void
} = {}): React.JSX.Element | null {
  const t = useT()
  const hosts = useSessionStore((s) => s.hosts)
  const services = listedServices(hosts)
  const windowMachineId = normalizeMachineId(useSessionStore((s) => s.windowMachineId))
  const defaultMachineId = normalizeMachineId(useSessionStore((s) => s.settings.defaultMachineId))
  const setDefaultMachine = useSessionStore((s) => s.setDefaultMachine)
  const incomingControllers = useSessionStore((s) => s.incomingControllers)
  const remoteControlStatus = useSessionStore((s) => s.remoteControlStatus)
  const appMode = useSessionStore((s) => s.applicationsMode)
  const incoming =
    incomingControllers.some((row) => row.online) || (remoteControlStatus?.clients.length ?? 0) > 0

  const current = services.find((service) => service.id === windowMachineId) ?? services[0]
  if (!current) return null

  const switchService = (machineId: string): void => {
    if (machineId === windowMachineId) return
    void (async () => {
      await useSessionStore.getState().switchMachine(machineId)
      await window.vav.hosts.show(machineId)
    })()
  }

  const openMenu = (anchor: HTMLElement): void => {
    const items: MenuItem[] = [
      { label: t('sidebar.switchService'), header: true },
      ...services.map((service) => ({
        label: service.name,
        checked: service.id === windowMachineId,
        onSelect: () => switchService(service.id)
      })),
      { label: '', divider: true },
      {
        label: t('sidebar.setDefaultService'),
        checked: defaultMachineId === current.id,
        onSelect: () => void setDefaultMachine(current.id)
      },
      {
        label: t('sidebar.pairDevice'),
        onSelect: () => useSessionStore.getState().openSettings('connect', undefined, current.id)
      },
      {
        label: t('sidebar.configureService'),
        icon: lucideMenuIcon('settings'),
        onSelect: () => useSessionStore.getState().openSettings('agents', undefined, current.id)
      }
    ]
    if (!isLocalMachine(current.id)) {
      items.push({
        label: t('machines.forget'),
        onSelect: () => void window.vav.hosts.forget(current.id)
      })
    }
    if (sessionMenuItems.length) {
      items.push({ label: '', divider: true }, ...sessionMenuItems)
    }
    items.push(
      { label: '', divider: true },
      {
        label: t('common.settingsEllipsis'),
        icon: lucideMenuIcon('settings'),
        onSelect: () => useSessionStore.getState().openSettings('appearance', undefined, current.id)
      },
      {
        label: t('sidebar.pictureInPicture'),
        icon: lucideMenuIcon('picture-in-picture'),
        onSelect: () => void useSessionStore.getState().setPictureInPicture(true)
      }
    )
    void showMenu(items, menuAnchor(anchor))
  }

  const navLabel = label ?? t('sidebar.devices')
  const title = isLocalMachine(current.id)
    ? `${current.name}${incoming ? ` · ${t('sidebar.connect')}` : ''}`
    : current.name

  return (
    <div
      className={variant === 'nav' ? 'sidebar-nav-devices' : 'sidebar-instance-switch'}
      data-testid="sidebar-service-bar"
    >
      <button
        type="button"
        className={variant === 'nav' ? 'sidebar-nav-item' : 'sidebar-instance-trigger'}
        data-testid={testId}
        data-app={variant === 'nav' ? 'devices' : undefined}
        data-active={variant === 'nav' && appMode === 'devices' ? 'true' : 'false'}
        data-machine-id={current.id}
        title={variant === 'nav' ? `${navLabel} · ${title}` : title}
        aria-label={variant === 'nav' ? navLabel : t('sidebar.switchService')}
        aria-haspopup="menu"
        onClick={(event) => {
          onOpen?.()
          openMenu(event.currentTarget)
        }}
      >
        {variant === 'nav' ? (
          <Smartphone size={14} aria-hidden />
        ) : isLocalMachine(current.id) ? (
          <House size={14} aria-hidden />
        ) : (
          <Monitor size={14} aria-hidden />
        )}
        <span className={variant === 'nav' ? undefined : 'sidebar-instance-name'}>
          {variant === 'nav' ? navLabel : current.name}
        </span>
        {variant === 'nav' ? <span className="sidebar-nav-machine">{current.name}</span> : null}
        {variant === 'nav' ? null : (
          <ChevronDown className="sidebar-foot-connect-chevron" size={11} aria-hidden />
        )}
      </button>
    </div>
  )
}
