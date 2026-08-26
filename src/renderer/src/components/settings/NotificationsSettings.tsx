import { useEffect, useState } from 'react'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'
import { PLATFORM } from '../../lib/platform'
import { InlineAlert, Toggle } from '../ui'

/**
 * Settings → 通知 (settings-notifications.rpml).
 */
export function NotificationsSettings(): React.JSX.Element {
  const t = useT()
  const settings = useSessionStore((s) => s.settings)
  const updateSettings = useSessionStore((s) => s.updateSettings)
  const [permission, setPermission] = useState<'granted' | 'denied' | 'unknown'>('unknown')

  useEffect(() => {
    void window.vav.notifications.permission().then(setPermission)
  }, [settings.notificationsEnabled])

  return (
    <div className="settings-form">
      {PLATFORM === 'win32' && (
        <>
          <div className="settings-section-title">{t('notifications.sectionTray')}</div>
          <div className="form-hint">{t('notifications.trayHintWin')}</div>
        </>
      )}
      {permission === 'denied' && settings.notificationsEnabled && (
        <InlineAlert
          kind="warning"
          title={t('notifications.unauthorized')}
          message={t('notifications.denied')}
        />
      )}

      <div className="form-row">
        <label>{t('notifications.enabled')}</label>
        <div className="control">
          <Toggle
            checked={settings.notificationsEnabled}
            title={t('notifications.enabled')}
            testId="settings-notifications-enabled"
            onChange={(notificationsEnabled) => void updateSettings({ notificationsEnabled })}
          />
        </div>
      </div>
      <div className="form-hint">{t('notifications.enabledHint')}</div>

      <div className="form-row">
        <label>{t('notifications.sound')}</label>
        <div className="control">
          <Toggle
            checked={settings.notificationSound}
            title={t('notifications.sound')}
            onChange={(notificationSound) => void updateSettings({ notificationSound })}
          />
        </div>
      </div>
      <div className="form-hint">{t('notifications.soundHint')}</div>

      <div className="settings-section-title">{t('notifications.sectionTypes')}</div>

      <div className="form-row">
        <label>{t('notifications.turnCompleteLabel')}</label>
        <div className="control">
          <Toggle
            checked={settings.notifyOnTurnComplete}
            title={t('notifications.turnCompleteLabel')}
            onChange={(notifyOnTurnComplete) => void updateSettings({ notifyOnTurnComplete })}
          />
        </div>
      </div>
      <div className="form-hint">{t('notifications.turnCompleteHint')}</div>

      <div className="form-row">
        <label>{t('notifications.askLabel')}</label>
        <div className="control">
          <Toggle
            checked={settings.notifyOnAskUserQuestion}
            title={t('notifications.askLabel')}
            onChange={(notifyOnAskUserQuestion) => void updateSettings({ notifyOnAskUserQuestion })}
          />
        </div>
      </div>
      <div className="form-hint">{t('notifications.askHint')}</div>

      <div className="form-row">
        <label>{t('notifications.approvalLabel')}</label>
        <div className="control">
          <Toggle
            checked={settings.notifyOnToolApproval}
            title={t('notifications.approvalLabel')}
            onChange={(notifyOnToolApproval) => void updateSettings({ notifyOnToolApproval })}
          />
        </div>
      </div>
      <div className="form-hint">{t('notifications.approvalHint')}</div>

      <div className="form-row">
        <label>{t('notifications.requestLabel')}</label>
        <div className="control">
          <Toggle
            checked={settings.notifyOnRequest}
            title={t('notifications.requestLabel')}
            onChange={(notifyOnRequest) => void updateSettings({ notifyOnRequest })}
          />
        </div>
      </div>
      <div className="form-hint">{t('notifications.requestHint')}</div>

      <div className="settings-section-title">{t('notifications.sectionPower')}</div>

      <div className="form-row">
        <label>{t('notifications.keepAwake')}</label>
        <div className="control">
          <Toggle
            checked={settings.keepAwakeWhileAgentRunning === true}
            title={t('notifications.keepAwake')}
            onChange={(keepAwakeWhileAgentRunning) =>
              void updateSettings({ keepAwakeWhileAgentRunning })
            }
          />
        </div>
      </div>
      <div className="form-hint">{t('notifications.keepAwakeHint')}</div>
    </div>
  )
}
