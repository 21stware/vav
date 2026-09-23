import { House, PanelLeft } from 'lucide-react'
import { useSessionStore } from '../state/sessionStore'
import { useSidebarFloatMode } from '../lib/sidebarLayout'
import { keys } from '../lib/platform'
import { useT } from '../i18n/useT'
import { Button } from './ui'

/**
 * Home sits left of the sidebar toggle. New session stays in the list nav.
 */
export function ShellLeadingControls(): React.JSX.Element {
  const t = useT()
  const toggleSidebar = useSessionStore((s) => s.toggleSidebar)
  const showHome = useSessionStore((s) => s.showHome)
  const homeActive = useSessionStore((s) => !s.agentVisible && !s.applicationsVisible)
  const floating = useSidebarFloatMode()

  const goHome = (): void => {
    showHome()
    if (floating && useSessionStore.getState().sidebarVisible) toggleSidebar()
  }

  return (
    <div className="shell-leading-controls titlebar-no-drag">
      <Button
        icon={<House size={14} />}
        title={t('common.homePage')}
        testId="home-page"
        pressed={homeActive}
        onClick={goHome}
      />
      <Button
        id="sessionsBtn"
        icon={<PanelLeft size={14} />}
        title={`${t('shortcut.toggleSidebar')} ${keys('⌘⇧H')}`}
        onClick={toggleSidebar}
      />
    </div>
  )
}
