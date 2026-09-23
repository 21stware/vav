import { ChartLine, Clock, HardDrive, Laptop, type LucideIcon } from 'lucide-react'
import {
  APP_CONTEXT_KIND_KEY,
  type AppColumnContext
} from '../lib/appColumnContext'
import { STORAGE_SOURCE_LABEL_KEY } from '../lib/storageSources'
import { NotebookDot } from '../lib/appNavIcons'
import { openInApp } from '../lib/openInApp'
import { useSessionStore } from '../state/sessionStore'
import type { ApplicationsMode } from '../state/sessionTypes'
import { useT } from '../i18n/useT'

const KIND_ICON: Record<ApplicationsMode, LucideIcon | typeof NotebookDot> = {
  storage: HardDrive,
  data: ChartLine,
  knowledge: NotebookDot,
  scheduled: Clock,
  devices: Laptop
}

/**
 * Ambient app-column location above the composer.
 * Not an attachment — list / item / selected each read differently.
 */
export function AppContextBar({
  context
}: {
  context: AppColumnContext
}): React.JSX.Element {
  const t = useT()
  const kindLabel = t(APP_CONTEXT_KIND_KEY[context.kind])
  const detail =
    context.title ||
    (context.storageSource ? t(STORAGE_SOURCE_LABEL_KEY[context.storageSource]) : '')
  const Icon = KIND_ICON[context.kind]
  const selection =
    context.level === 'selected'
      ? context.selectionLabel ||
        (context.selectionCount > 1
          ? t('composer.appContextSelections', { n: context.selectionCount })
          : t('composer.appContextSelected'))
      : null

  const reveal = (): void => {
    const store = useSessionStore.getState()
    if (!store.applicationsVisible) store.toggleApplications()
    if (context.objectId) {
      if (context.level === 'list') store.focusAppObject(context.objectId)
      else store.openAppObject(context.objectId)
      return
    }
    if (context.path) {
      void openInApp(context.path)
      return
    }
    store.setApplicationsMode(context.kind)
  }

  return (
    <button
      type="button"
      className="app-context"
      data-testid="app-context"
      data-level={context.level}
      data-kind={context.kind}
      title={context.path || detail || kindLabel}
      aria-label={t('composer.appContext')}
      onClick={reveal}
    >
      <span className="app-context-icon" aria-hidden>
        <Icon size={12} strokeWidth={2} />
      </span>
      <span className="app-context-kind">{kindLabel}</span>
      {detail ? (
        <>
          <span className="app-context-sep" aria-hidden>
            ·
          </span>
          <span className="app-context-detail">{detail}</span>
        </>
      ) : null}
      {selection ? (
        <>
          <span className="app-context-sep" aria-hidden>
            ·
          </span>
          <span className="app-context-selection">{selection}</span>
        </>
      ) : null}
    </button>
  )
}
