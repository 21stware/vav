import type { ReactNode } from 'react'
import { ChevronLeft, X } from 'lucide-react'
import { APP_NAV } from '../lib/appNav'
import { useShowShellLeading } from '../lib/sidebarLayout'
import { useSessionStore } from '../state/sessionStore'
import { useT } from '../i18n/useT'
import { Button } from './ui'
import { ShellLeadingControls } from './ShellLeadingControls'

export function AppModeTabs({
  trailing,
  canBack = false
}: {
  trailing?: ReactNode
  canBack?: boolean
} = {}): React.JSX.Element {
  const t = useT()
  const agentVisible = useSessionStore((s) => s.agentVisible)
  const showShellLeading = useShowShellLeading() && !agentVisible
  const mode = useSessionStore((s) => s.applicationsMode)
  const setApplicationsMode = useSessionStore((s) => s.setApplicationsMode)
  const popAppRoute = useSessionStore((s) => s.popAppRoute)
  const hideApplications = (): void => {
    const store = useSessionStore.getState()
    if (store.applicationsVisible) store.toggleApplications()
  }

  return (
    <nav className="app-mode-tabs titlebar-drag" data-testid="app-mode-tabs">
      {showShellLeading ? (
        <div className="titlebar-no-drag">
          <ShellLeadingControls />
        </div>
      ) : null}
      <span className="app-mode-tabs-back titlebar-no-drag">
        {canBack ? (
          <Button
            icon={<ChevronLeft size={16} strokeWidth={2.25} />}
            variant="ghost"
            testId="app-back"
            title={t('app.back')}
            onClick={popAppRoute}
          />
        ) : null}
      </span>
      <div className="app-mode-tabs-items sidebar-service-bar">
        {APP_NAV.map((item) => {
          const Icon = item.Icon
          const label = t(item.labelKey)
          const active = mode === item.mode
          return (
            <button
              key={item.mode}
              type="button"
              className="sidebar-service-chip app-mode-tab"
              data-testid={item.testId}
              data-app={item.mode}
              data-active={active ? 'true' : 'false'}
              data-expanded={active ? 'true' : 'false'}
              aria-pressed={active}
              aria-label={label}
              title={label}
              onClick={() => setApplicationsMode(item.mode)}
            >
              <Icon size={14} aria-hidden />
              <span className="sidebar-service-label-clip" aria-hidden="true">
                <span className="sidebar-service-label-inner">
                  <span className="sidebar-service-label">{label}</span>
                </span>
              </span>
            </button>
          )
        })}
      </div>
      <span className="spacer" aria-hidden="true" />
      {trailing ? (
        <div className="applications-content-bar-trailing titlebar-no-drag">{trailing}</div>
      ) : null}
      {trailing ? <span className="app-mode-tabs-divider" aria-hidden="true" /> : null}
      <Button
        icon={<X size={15} strokeWidth={2} />}
        variant="ghost"
        testId="close-app"
        title={t('applications.close')}
        onClick={hideApplications}
      />
    </nav>
  )
}
