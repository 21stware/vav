import { FolderOpen, Timer } from 'lucide-react'
import { isLocalMachine } from '@shared/workspaceHost'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'

export type OnboardingWorkspace = { kind: 'temp' } | { kind: 'folder'; path: string }

function baseName(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path
}

export function WorkspaceStep({
  value,
  onChange
}: {
  value: OnboardingWorkspace
  onChange: (next: OnboardingWorkspace) => void
}): React.JSX.Element {
  const t = useT()
  const recent = useSessionStore((s) => s.settings.recentWorkspaceDirectories)
  const recentLocal = (recent ?? []).filter((ref) => isLocalMachine(ref.machineId)).slice(0, 3)
  const picked = value.kind === 'folder' ? value.path : null
  // A recent folder is listed on its own row; only a fresh pick fills the chooser.
  const pickedFresh = picked && !recentLocal.some((ref) => ref.path === picked) ? picked : null

  const pick = async (): Promise<void> => {
    const path = await window.vav.settings.pickDirectory().catch(() => null)
    if (path) onChange({ kind: 'folder', path })
  }

  return (
    <div className="onboarding-options" role="radiogroup" aria-label={t('onboarding.workspace.title')}>
      <button
        type="button"
        role="radio"
        aria-checked={pickedFresh !== null}
        className="onboarding-option"
        data-selected={pickedFresh !== null ? 'true' : 'false'}
        data-testid="onboarding-workspace-pick"
        onClick={() => void pick()}
      >
        <span className="onboarding-option-icon">
          <FolderOpen size={16} strokeWidth={1.75} />
        </span>
        <span className="onboarding-option-text">
          <span className="onboarding-option-title">
            {pickedFresh ? baseName(pickedFresh) : t('onboarding.workspace.pick')}
          </span>
          <span className="onboarding-option-desc">
            {pickedFresh ?? t('onboarding.workspace.pickHint')}
          </span>
        </span>
        {pickedFresh ? (
          <span className="onboarding-option-action">{t('onboarding.workspace.change')}</span>
        ) : null}
      </button>

      {recentLocal.length > 0 ? (
        <div className="onboarding-options-label">{t('onboarding.workspace.recent')}</div>
      ) : null}
      {recentLocal.map((ref) => (
        <button
          key={ref.path}
          type="button"
          role="radio"
          aria-checked={picked === ref.path}
          className="onboarding-option is-compact"
          data-selected={picked === ref.path ? 'true' : 'false'}
          onClick={() => onChange({ kind: 'folder', path: ref.path })}
        >
          <span className="onboarding-option-icon">
            <FolderOpen size={14} strokeWidth={1.75} />
          </span>
          <span className="onboarding-option-text">
            <span className="onboarding-option-title">{baseName(ref.path)}</span>
            <span className="onboarding-option-desc">{ref.path}</span>
          </span>
        </button>
      ))}

      <button
        type="button"
        role="radio"
        aria-checked={value.kind === 'temp'}
        className="onboarding-option"
        data-selected={value.kind === 'temp' ? 'true' : 'false'}
        data-testid="onboarding-workspace-temp"
        onClick={() => onChange({ kind: 'temp' })}
      >
        <span className="onboarding-option-icon">
          <Timer size={16} strokeWidth={1.75} />
        </span>
        <span className="onboarding-option-text">
          <span className="onboarding-option-title">{t('onboarding.workspace.temp')}</span>
          <span className="onboarding-option-desc">{t('onboarding.workspace.tempHint')}</span>
        </span>
      </button>
    </div>
  )
}
