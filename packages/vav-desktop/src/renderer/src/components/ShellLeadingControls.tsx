import { PanelLeft } from 'lucide-react'
import { useSessionStore } from '../state/sessionStore'
import { keys } from '../lib/platform'
import { useT } from '../i18n/useT'
import { Button } from './ui'

/** Sidebar toggle. New session stays in the list nav. */
export function ShellLeadingControls(): React.JSX.Element {
  const t = useT()
  const toggleSidebar = useSessionStore((s) => s.toggleSidebar)

  return (
    <div className="shell-leading-controls titlebar-no-drag">
      <Button
        id="sessionsBtn"
        icon={<PanelLeft size={14} />}
        title={`${t('shortcut.toggleSidebar')} ${keys('⌘⇧H')}`}
        onClick={toggleSidebar}
      />
    </div>
  )
}
