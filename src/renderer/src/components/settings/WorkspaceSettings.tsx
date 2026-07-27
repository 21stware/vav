import type { ShellKind } from '@shared/types'
import { shellsFor } from '@shared/platform'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'
import { Button, Segmented, Toggle } from '../ui'
import { PLATFORM } from '../../lib/platform'

const SHELLS = shellsFor(PLATFORM)

export function WorkspaceSettings(): React.JSX.Element {
  const t = useT()
  const settings = useSessionStore((s) => s.settings)
  const updateSettings = useSessionStore((s) => s.updateSettings)

  return (
    <div className="form">
      <div className="form-row">
        <label>{t('workspace.defaultDir')}</label>
        <div className="control">
          <input
            className="text-field"
            placeholder={t('workspace.defaultDirPlaceholder')}
            value={settings.defaultWorkingDirectory}
            onChange={(event) =>
              void updateSettings({ defaultWorkingDirectory: event.target.value })
            }
          />
          <Button
            label={t('workspace.pick')}
            variant="secondary"
            size="sm"
            onClick={async () => {
              const path = await window.vav.settings.pickDirectory()
              if (path) void updateSettings({ defaultWorkingDirectory: path })
            }}
          />
          {settings.defaultWorkingDirectory && (
            <Button
              label={t('ui.restoreTemp')}
              size="sm"
              onClick={() => void updateSettings({ defaultWorkingDirectory: '' })}
            />
          )}
        </div>
      </div>
      <div className="form-hint">{t('workspace.defaultDirHint')}</div>

      <div className="form-row">
        <label>{t('workspace.shell')}</label>
        <div className="control">
          <Segmented<ShellKind>
            options={SHELLS}
            value={settings.shell}
            onChange={(shell) => void updateSettings({ shell })}
          />
        </div>
      </div>
      <div className="form-hint">
        {SHELLS.map((option) => `${option.label} = ${option.hint}`).join(' · ')}
        {SHELLS.length > 1 && t('workspace.shellHintSuffix')}
      </div>

      <div className="form-row">
        <label>{t('workspace.timeout')}</label>
        <div className="control">
          <input
            type="range"
            min={10}
            max={600}
            step={10}
            style={{ flex: 1 }}
            value={settings.commandTimeout}
            onChange={(event) =>
              void updateSettings({ commandTimeout: Number(event.target.value) })
            }
          />
          <span className="muted" style={{ width: 52 }}>
            {t('workspace.timeoutSeconds', { n: settings.commandTimeout })}
          </span>
        </div>
      </div>

      <div className="form-row">
        <label>{t('workspace.autoApprove')}</label>
        <div className="control">
          <Toggle
            checked={settings.autoApproveReadonly}
            onChange={(autoApproveReadonly) => void updateSettings({ autoApproveReadonly })}
          />
        </div>
      </div>
      <div className="form-hint">{t('workspace.autoApproveHint')}</div>

      <div className="form-hint">{t('workspace.securityHint')}</div>
    </div>
  )
}
