import { useEffect, useState } from 'react'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'
import { InlineAlert, Toggle } from '../ui'
import { IS_MAC } from '../../lib/platform'

/**
 * Settings → 通知 (settings-notifications.rpml).
 */
export function NotificationsSettings(): React.JSX.Element {
  const t = useT()
  const settings = useSessionStore((s) => s.settings)
  const updateSettings = useSessionStore((s) => s.updateSettings)
  const showDialog = useSessionStore((s) => s.showDialog)
  const [permission, setPermission] = useState<'granted' | 'denied' | 'unknown'>('unknown')

  useEffect(() => {
    void window.vav.notifications.permission().then(setPermission)
  }, [settings.notificationsEnabled])

  const setHideDock = (hideDockIcon: boolean): void => {
    if (hideDockIcon === settings.hideDockIcon) return
    const patch =
      hideDockIcon && !settings.trayEnabled
        ? { hideDockIcon: true, trayEnabled: true }
        : { hideDockIcon }
    void updateSettings(patch).then(() => {
      showDialog({
        title: t('dialog.restartRequired'),
        body: t('appearance.hideDockRestart'),
        cancelLabel: t('dialog.restartLater'),
        confirmLabel: t('dialog.restartNow'),
        onConfirm: () => void window.vav.window.relaunch()
      })
    })
  }

  return (
    <div className="settings-form">
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

      <div className="settings-section-title">{t('notifications.sectionTray')}</div>

      <div className="form-row">
        <label>{t('notifications.trayLabel')}</label>
        <div className="control">
          <Toggle
            checked={settings.trayEnabled}
            title={t('notifications.trayLabel')}
            onChange={(trayEnabled) => void updateSettings({ trayEnabled })}
          />
        </div>
      </div>
      <div className="form-hint">{t('notifications.trayHint')}</div>

      {IS_MAC && (
        <>
          <div className="form-row">
            <label>{t('appearance.hideDock')}</label>
            <div className="control">
              <Toggle
                checked={settings.hideDockIcon}
                title={t('appearance.hideDock')}
                onChange={setHideDock}
              />
            </div>
          </div>
          <div className="form-hint">{t('notifications.hideDockHint')}</div>
        </>
      )}
    </div>
  )
}
