import { ChevronDown, House, Monitor } from 'lucide-react'
import { isLocalMachine, listedServices, normalizeMachineId } from '@shared/workspaceHost'
import {
  appearanceBaseForMachine,
  appearanceForMachine,
  patchMachineAppearance
} from '@shared/machineAppearance'
import type { ThemeMode } from '@shared/types'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'
import { menuAnchor, showMenu, type MenuItem } from '../../lib/nativeMenu'
import { lucideMenuIcon } from '../../lib/menuIcons'

export function SidebarServiceBar(): React.JSX.Element {
  const t = useT()
  const hosts = useSessionStore((s) => s.hosts)
  const services = listedServices(hosts)
  const windowMachineId = normalizeMachineId(useSessionStore((s) => s.windowMachineId))
  const defaultMachineId = normalizeMachineId(useSessionStore((s) => s.settings.defaultMachineId))
  const settings = useSessionStore((s) => s.settings)
  const setDefaultMachine = useSessionStore((s) => s.setDefaultMachine)
  const updateSettings = useSessionStore((s) => s.updateSettings)
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
    const current = appearanceForMachine(
      settings,
      machineId,
      appearanceBaseForMachine(settings, machineId, hosts)
    ).theme
    const applyTheme = (theme: ThemeMode): void => {
      void updateSettings({
        machineAppearances: patchMachineAppearance(settings.machineAppearances, machineId, {
          theme
        })
      })
    }
    const items: MenuItem[] = [
      {
        label: t('appearance.theme.light'),
        checked: current === 'light',
        onSelect: () => applyTheme('light')
      },
      {
        label: t('appearance.theme.dark'),
        checked: current === 'dark',
        onSelect: () => applyTheme('dark')
      },
      {
        label: t('appearance.theme.system'),
        checked: current === 'system',
        onSelect: () => applyTheme('system')
      },
      { label: '', divider: true },
      {
        label: t('sidebar.setDefaultService'),
        checked: defaultMachineId === machineId,
        onSelect: () => void setDefaultMachine(machineId)
      },
      {
        label: t('sidebar.pairDevice'),
        onSelect: () => useSessionStore.getState().openSettings('connect')
      },
      {
        label: t('sidebar.configureService'),
        icon: lucideMenuIcon('settings'),
        onSelect: () => useSessionStore.getState().openSettings('agents')
      },
      {
        label: t('sidebar.serviceThemeSettings'),
        onSelect: () => useSessionStore.getState().openSettings('appearance')
      }
    ]
    if (!isLocalMachine(machineId)) {
      items.push({
        label: t('machines.forget'),
        onSelect: () => void window.vav.hosts.forget(machineId)
      })
    }
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
            <Icon size={13} aria-hidden />
            <span className="sidebar-service-label-clip">
              <span className="sidebar-service-label">{service.name}</span>
            </span>
            {expanded ? (
              <ChevronDown className="sidebar-foot-connect-chevron" size={11} aria-hidden />
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
