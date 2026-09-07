import { useEffect, useState } from 'react'
import {
  KEEP_AWAKE_BATTERY_FLOOR_MAX,
  KEEP_AWAKE_BATTERY_FLOOR_MIN,
  type KeepAwakeStatus
} from '@shared/sleepBlocker'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'
import { IS_MAC, PLATFORM } from '../../lib/platform'
import { Button, InlineAlert, Toggle } from '../ui'

/**
 * Settings → 通知 (settings-notifications.rpml).
 */
export function NotificationsSettings(): React.JSX.Element {
  const t = useT()
  const settings = useSessionStore((s) => s.settings)
  const updateSettings = useSessionStore((s) => s.updateSettings)
  const showDialog = useSessionStore((s) => s.showDialog)
  const [permission, setPermission] = useState<'granted' | 'denied' | 'unknown'>('unknown')
  const [keepAwake, setKeepAwake] = useState<KeepAwakeStatus | null>(null)
  const [keepAwakeBusy, setKeepAwakeBusy] = useState(false)
  const [keepAwakeNotice, setKeepAwakeNotice] = useState<string | null>(null)

  useEffect(() => {
    void window.vav.notifications.permission().then(setPermission)
  }, [settings.notificationsEnabled])

  useEffect(() => {
    if (!IS_MAC) return
    let cancelled = false
    void window.vav.settings.keepAwakeStatus().then((status) => {
      if (!cancelled) setKeepAwake(status)
    })
    const off = window.vav.onKeepAwakeStatus((status) => {
      if (!cancelled) setKeepAwake(status)
    })
    return () => {
      cancelled = true
      off()
    }
  }, [])

  const grantLid = async (): Promise<void> => {
    setKeepAwakeBusy(true)
    setKeepAwakeNotice(null)
    try {
      const result = await window.vav.settings.keepAwakeGrant()
      if (result.ok) {
        setKeepAwake(await window.vav.settings.keepAwakeStatus())
        return
      }
      if ('cancelled' in result && result.cancelled) {
        setKeepAwakeNotice(t('notifications.keepAwakeGrantCancelled'))
        return
      }
      setKeepAwakeNotice(
        t('notifications.keepAwakeGrantFailed', {
          error: 'error' in result ? result.error : ''
        })
      )
    } finally {
      setKeepAwakeBusy(false)
    }
  }

  const revokeLid = (): void => {
    showDialog({
      title: t('notifications.keepAwakeRevokeTitle'),
      body: t('notifications.keepAwakeRevokeBody'),
      confirmLabel: t('notifications.keepAwakeRevoke'),
      destructive: true,
      onConfirm: () => {
        void (async () => {
          setKeepAwakeBusy(true)
          setKeepAwakeNotice(null)
          try {
            const result = await window.vav.settings.keepAwakeRevoke()
            if (!result.ok && !('cancelled' in result && result.cancelled)) {
              setKeepAwakeNotice(
                t('notifications.keepAwakeGrantFailed', {
                  error: 'error' in result ? result.error : ''
                })
              )
            }
            setKeepAwake(await window.vav.settings.keepAwakeStatus())
          } finally {
            setKeepAwakeBusy(false)
          }
        })()
      }
    })
  }

  const keepAwakeOn = settings.keepAwakeWhileAgentRunning === true
  const statusHint = keepAwakeStatusHint(t, keepAwakeOn, keepAwake, settings.keepAwakeBatteryFloorPercent)

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
            checked={keepAwakeOn}
            title={t('notifications.keepAwake')}
            testId="settings-keep-awake"
            onChange={(keepAwakeWhileAgentRunning) =>
              void updateSettings({ keepAwakeWhileAgentRunning })
            }
          />
        </div>
      </div>
      <div className="form-hint">
        {t(IS_MAC ? 'notifications.keepAwakeHintMac' : 'notifications.keepAwakeHint')}
      </div>

      {IS_MAC && keepAwakeOn ? (
        <>
          <div className="form-row">
            <label>{t('notifications.keepAwakeLid')}</label>
            <div className="control">
              {keepAwake?.granted ? (
                <>
                  <span className="muted">{t('notifications.keepAwakeGranted')}</span>
                  <Button
                    label={t('notifications.keepAwakeRevoke')}
                    variant="ghost"
                    size="sm"
                    disabled={keepAwakeBusy}
                    testId="settings-keep-awake-revoke"
                    onClick={revokeLid}
                  />
                </>
              ) : (
                <Button
                  label={t('notifications.keepAwakeGrant')}
                  variant="primary"
                  size="sm"
                  disabled={keepAwakeBusy}
                  testId="settings-keep-awake-grant"
                  onClick={() => void grantLid()}
                />
              )}
            </div>
          </div>
          <div className="form-hint">{t('notifications.keepAwakeGrantHint')}</div>

          <div className="form-row">
            <label>{t('notifications.keepAwakeFloor')}</label>
            <div className="control">
              <input
                type="range"
                min={KEEP_AWAKE_BATTERY_FLOOR_MIN}
                max={KEEP_AWAKE_BATTERY_FLOOR_MAX}
                step={1}
                style={{ flex: 1 }}
                value={settings.keepAwakeBatteryFloorPercent}
                data-testid="settings-keep-awake-floor"
                onChange={(event) =>
                  void updateSettings({
                    keepAwakeBatteryFloorPercent: Number(event.target.value)
                  })
                }
              />
              <span className="muted" style={{ width: 42 }}>
                {settings.keepAwakeBatteryFloorPercent}%
              </span>
            </div>
          </div>
          <div className="form-hint">{t('notifications.keepAwakeFloorHint')}</div>

          {statusHint ? <div className="form-hint">{statusHint}</div> : null}
          {keepAwakeNotice ? <InlineAlert kind="warning" message={keepAwakeNotice} /> : null}
          {keepAwakeOn && keepAwake && !keepAwake.granted ? (
            <InlineAlert kind="warning" message={t('notifications.keepAwakeStatusNeedGrant')} />
          ) : null}
        </>
      ) : null}
    </div>
  )
}

function keepAwakeStatusHint(
  t: ReturnType<typeof useT>,
  enabled: boolean,
  status: KeepAwakeStatus | null,
  floor: number
): string | null {
  if (!enabled || !status) return null
  if (status.safetyHold === 'battery') {
    return t('notifications.keepAwakeStatusSafetyBattery', {
      percent: status.batteryPercent,
      floor
    })
  }
  if (status.safetyHold === 'low-power') {
    return t('notifications.keepAwakeStatusSafetyLpm')
  }
  if (status.lidSleepBlocked) return t('notifications.keepAwakeStatusLid')
  if (status.idleBlocked && !status.granted) return t('notifications.keepAwakeStatusIdle')
  if (status.idleBlocked) return t('notifications.keepAwakeStatusLid')
  return t('notifications.keepAwakeStatusWaiting')
}
