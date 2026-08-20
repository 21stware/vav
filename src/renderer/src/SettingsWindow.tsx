import { useCallback, useEffect, useRef } from 'react'
import {
  Bell,
  Bot,
  ChartNoAxesColumn,
  FileCheck2,
  Folder,
  Info,
  KeyRound,
  Keyboard,
  Palette,
  Terminal
} from 'lucide-react'
import type { SettingsView } from '@shared/ipc'
import type { MessageKey } from '@shared/i18n'
import {
  installAgentModelCatalogBridge,
  installSettingsBridge,
  installUpdateBridge,
  useSessionStore
} from './state/sessionStore'
import { useT } from './i18n/useT'
import { useAppearance } from './lib/appearance'
import { installDefaultContextMenu } from './lib/nativeMenu'
import { installAnalysisBridge } from './lib/analysisCache'
import { installInstallRunBridge } from './state/installRunStore'
import { AppToast } from './components/AppToast'
import { ApiSettings } from './components/settings/ApiSettings'
import { WorkspaceSettings } from './components/settings/WorkspaceSettings'
import { AppearanceSettings } from './components/settings/AppearanceSettings'
import { NotificationsSettings } from './components/settings/NotificationsSettings'
import { CliSettings } from './components/settings/CliSettings'
import { AgentsSettings } from './components/settings/AgentsSettings'
import { FileAssociationsSettings } from './components/settings/FileAssociationsSettings'
import { KeyBindingsSettings } from './components/settings/KeyBindingsSettings'
import { AboutSettings } from './components/settings/AboutSettings'
import { AnalysisSettings } from './components/settings/AnalysisSettings'

const NAV_ICON = 14

const CATEGORY_KEYS: { id: SettingsView; labelKey: MessageKey; icon: React.JSX.Element }[] = [
  { id: 'api', labelKey: 'settings.nav.api', icon: <KeyRound size={NAV_ICON} strokeWidth={1.75} /> },
  {
    id: 'analysis',
    labelKey: 'settings.nav.analysis',
    icon: <ChartNoAxesColumn size={NAV_ICON} strokeWidth={1.75} />
  },
  {
    id: 'workspace',
    labelKey: 'settings.nav.workspace',
    icon: <Folder size={NAV_ICON} strokeWidth={1.75} />
  },
  {
    id: 'appearance',
    labelKey: 'settings.nav.appearance',
    icon: <Palette size={NAV_ICON} strokeWidth={1.75} />
  },
  {
    id: 'keybindings',
    labelKey: 'settings.nav.keybindings',
    icon: <Keyboard size={NAV_ICON} strokeWidth={1.75} />
  },
  {
    id: 'notifications',
    labelKey: 'settings.nav.notifications',
    icon: <Bell size={NAV_ICON} strokeWidth={1.75} />
  },
  { id: 'agents', labelKey: 'settings.nav.agents', icon: <Bot size={NAV_ICON} strokeWidth={1.75} /> },
  { id: 'cli', labelKey: 'settings.nav.cli', icon: <Terminal size={NAV_ICON} strokeWidth={1.75} /> },
  {
    id: 'file-associations',
    labelKey: 'settings.nav.fileAssociations',
    icon: <FileCheck2 size={NAV_ICON} strokeWidth={1.75} />
  },
  { id: 'about', labelKey: 'settings.nav.about', icon: <Info size={NAV_ICON} strokeWidth={1.75} /> }
]

function initialCategory(): SettingsView {
  const requested = new URLSearchParams(window.location.search).get('category')
  return CATEGORY_KEYS.some((c) => c.id === requested) ? (requested as SettingsView) : 'api'
}

function initialFocusAgentId(): string | null {
  return new URLSearchParams(window.location.search).get('agentId')?.trim() || null
}

/**
 * Settings, in a window of its own rather than a sheet over the transcript.
 *
 * It runs a second copy of the session store, so it reads and writes through
 * the same IPC surface as the main window and the two stay in step via
 * `installSettingsBridge`. Fields save on change; close via the window chrome
 * or Escape (no Done footer).
 */
export default function SettingsWindow(): React.JSX.Element {
  const t = useT()
  const ready = useSessionStore((s) => s.ready)
  const bootstrap = useSessionStore((s) => s.bootstrap)
  const category = useSessionStore((s) => s.settingsCategory)
  const prevCategory = useRef<SettingsView | null>(null)
  const animateEnter = prevCategory.current !== null && prevCategory.current !== category
  useEffect(() => {
    prevCategory.current = category
  }, [category])

  useEffect(() => {
    useSessionStore.setState({
      settingsCategory: initialCategory(),
      settingsFocusAgentId: initialFocusAgentId()
    })
    // Light: settings only — never load the active chat transcript into this window.
    void bootstrap(undefined, { light: true })
  }, [bootstrap])

  useEffect(() => {
    const offSettings = installSettingsBridge()
    const offUpdates = installUpdateBridge()
    const offModels = installAgentModelCatalogBridge()
    const offView = window.vav.onSettingsView((payload) =>
      useSessionStore.setState({
        settingsCategory: payload.view,
        settingsFocusAgentId: payload.agentId?.trim() || null
      })
    )
    const offMenu = installDefaultContextMenu()
    const offInstall = installInstallRunBridge()
    const offAnalysis = installAnalysisBridge()
    void useSessionStore.getState().refreshAgentModelCatalog(false)
    return () => {
      offSettings()
      offUpdates()
      offModels()
      offView()
      offMenu()
      offInstall()
      offAnalysis()
    }
  }, [])

  useAppearance()

  const close = useCallback((): void => {
    void window.vav.window.closeSettings()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  if (!ready) return <div className="settings-window" />

  const title = t(CATEGORY_KEYS.find((c) => c.id === category)?.labelKey ?? 'settings.nav.api')

  return (
    <div className="settings-window">
      <nav className="settings-nav">
        {CATEGORY_KEYS.map((item) => (
          <div
            key={item.id}
            className={`conv-row${item.id === category ? ' selected' : ''}`}
            onClick={() => useSessionStore.setState({ settingsCategory: item.id })}
          >
            <span className="conv-icon">{item.icon}</span>
            <span className="conv-title">{t(item.labelKey)}</span>
          </div>
        ))}
      </nav>

      <div className="settings-main">
        <header className="settings-head">{title}</header>
        <div className="settings-body">
          {/* Remount on switch for the enter fade. Skip it on first paint —
              the window is often already mounted (warm/hidden), and an
              opacity-0 start would stay blank until the next click. */}
          <div
            key={category}
            className={`settings-body-panel${animateEnter ? ' is-enter' : ''}`}
          >
            {category === 'api' && <ApiSettings />}
            {category === 'analysis' && <AnalysisSettings />}
            {category === 'workspace' && <WorkspaceSettings />}
            {category === 'appearance' && <AppearanceSettings />}
            {category === 'keybindings' && <KeyBindingsSettings />}
            {category === 'notifications' && <NotificationsSettings />}
            {category === 'agents' && <AgentsSettings />}
            {category === 'cli' && <CliSettings />}
            {category === 'file-associations' && <FileAssociationsSettings />}
            {category === 'about' && <AboutSettings />}
          </div>
        </div>
      </div>

      <AppToast />
    </div>
  )
}
