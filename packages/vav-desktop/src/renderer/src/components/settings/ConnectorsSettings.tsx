import { useCallback, useEffect, useState } from 'react'
import { LogIn } from 'lucide-react'
import {
  connectorCliName,
  type ConnectorAuthPage,
  type ConnectorAuthRow,
  type ConnectorId
} from '@shared/connector'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'
import { Button, Toggle } from '../ui'

const LOGIN_POLL_MS = 2_000

function authLabel(
  row: ConnectorAuthRow | undefined,
  t: ReturnType<typeof useT>
): string {
  if (!row) return t('connector.auth.none')
  const cli = connectorCliName(row.id)
  if (row.settingsPresent && row.cliPresent) return t('connector.auth.override', { cli })
  if (row.settingsPresent) return t('connector.auth.settings')
  if (row.source === 'env') return t('connector.auth.env')
  if (row.cliPresent || row.source === 'cli') return t('connector.auth.cli', { cli })
  if (row.present) return t('connector.auth.cli', { cli })
  return t('connector.auth.none')
}

export function ConnectorsSettings(): React.JSX.Element {
  const t = useT()
  const settings = useSessionStore((s) => s.settings)
  const updateSettings = useSessionStore((s) => s.updateSettings)
  const [page, setPage] = useState<ConnectorAuthPage | null>(null)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [cfDraft, setCfDraft] = useState('')
  const [cfSaving, setCfSaving] = useState(false)
  const [sbDraft, setSbDraft] = useState('')
  const [sbSaving, setSbSaving] = useState(false)
  const [vercelDraft, setVercelDraft] = useState('')
  const [vercelSaving, setVercelSaving] = useState(false)

  const loadAuth = useCallback(async (): Promise<ConnectorAuthPage | null> => {
    if (typeof window.vav.connectors?.authStatus !== 'function') return null
    try {
      const next = await window.vav.connectors.authStatus()
      setPage(next)
      return next
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : String(err))
      return null
    }
  }, [])

  useEffect(() => {
    void loadAuth()
  }, [
    loadAuth,
    settings.cloudflareApiTokenPresent,
    settings.supabaseAccessTokenPresent,
    settings.vercelApiTokenPresent
  ])

  const runningId =
    page?.login.status === 'running' ? page.login.connector : null

  useEffect(() => {
    if (!runningId) return
    let cancelled = false
    const tick = async (): Promise<void> => {
      const next = await loadAuth()
      if (cancelled || !next) return
      if (next.login.status === 'error') {
        setLoginError(next.login.message || t('connector.loginFailed'))
        return
      }
      if (next.login.status === 'ok' || next.login.status === 'cancelled') {
        setLoginError(null)
      }
    }
    const timer = window.setInterval(() => void tick(), LOGIN_POLL_MS)
    void tick()
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [runningId, loadAuth, t])

  const beginLogin = async (id: ConnectorId): Promise<void> => {
    setLoginError(null)
    if (typeof window.vav.connectors?.beginLogin !== 'function') {
      setLoginError(t('connector.cliMissing', { cli: connectorCliName(id) }))
      return
    }
    try {
      const next = await window.vav.connectors.beginLogin(id)
      setPage(next)
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : String(err))
    }
  }

  const cancelLogin = async (): Promise<void> => {
    if (typeof window.vav.connectors?.cancelLogin !== 'function') return
    const next = await window.vav.connectors.cancelLogin(runningId ?? undefined)
    setPage(next)
  }

  const saveCloudflareToken = async (): Promise<void> => {
    setCfSaving(true)
    try {
      await window.vav.settings.setCloudflareApiToken(cfDraft.trim())
      setCfDraft('')
      await loadAuth()
    } finally {
      setCfSaving(false)
    }
  }

  const saveSupabaseToken = async (): Promise<void> => {
    setSbSaving(true)
    try {
      await window.vav.settings.setSupabaseAccessToken(sbDraft.trim())
      setSbDraft('')
      await loadAuth()
    } finally {
      setSbSaving(false)
    }
  }

  const saveVercelToken = async (): Promise<void> => {
    setVercelSaving(true)
    try {
      await window.vav.settings.setVercelApiToken(vercelDraft.trim())
      setVercelDraft('')
      await loadAuth()
    } finally {
      setVercelSaving(false)
    }
  }

  const renderLogin = (id: ConnectorId): React.JSX.Element => {
    const row = page?.rows.find((item) => item.id === id)
    const running = runningId === id
    const busy = runningId != null
    return (
      <div className="form-row">
        <label>{t('connector.signIn')}</label>
        <div className="control">
          {running ? (
            <Button
              label={t('common.cancel')}
              size="sm"
              testId={`settings-connector-cancel-${id}`}
              onClick={() => void cancelLogin()}
            />
          ) : (
            <Button
              icon={<LogIn size={14} />}
              label={t('connector.signIn')}
              variant="secondary"
              size="sm"
              disabled={busy}
              testId={`settings-connector-login-${id}`}
              onClick={() => void beginLogin(id)}
            />
          )}
          <span className="connector-auth-status">
            {running ? t('connector.signingIn') : authLabel(row, t)}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="form" data-testid="settings-connectors">
      <div className="form-hint">{t('connector.pageHint')}</div>
      {loginError ? <div className="form-hint">{loginError}</div> : null}

      <div className="form-row">
        <label>{t('workspace.githubTray')}</label>
        <div className="control">
          <Toggle
            checked={settings.githubTrayEnabled !== false}
            title={t('workspace.githubTray')}
            testId="settings-github-tray"
            onChange={(githubTrayEnabled) => void updateSettings({ githubTrayEnabled })}
          />
        </div>
      </div>
      <div className="form-hint">{t('connector.github.hint')}</div>
      {renderLogin('github')}

      <div className="form-row">
        <label>{t('workspace.cloudflareTray')}</label>
        <div className="control">
          <Toggle
            checked={settings.cloudflareTrayEnabled === true}
            title={t('workspace.cloudflareTray')}
            testId="settings-cloudflare-tray"
            onChange={(cloudflareTrayEnabled) => void updateSettings({ cloudflareTrayEnabled })}
          />
        </div>
      </div>
      <div className="form-hint">{t('connector.cloudflare.hint')}</div>
      {renderLogin('cloudflare')}

      {settings.cloudflareTrayEnabled === true ? (
        <>
          <div className="form-row">
            <label>{t('workspace.cloudflareToken')}</label>
            <div className="control">
              <input
                className="text-field"
                type="password"
                placeholder={
                  settings.cloudflareApiTokenPresent
                    ? t('workspace.cloudflareTokenConfigured')
                    : t('workspace.cloudflareTokenPlaceholder')
                }
                value={cfDraft}
                onChange={(event) => setCfDraft(event.currentTarget.value)}
              />
              <Button
                label={cfSaving ? t('workspace.braveSaving') : t('workspace.braveSave')}
                variant="secondary"
                size="sm"
                disabled={cfSaving || !cfDraft.trim()}
                onClick={() => void saveCloudflareToken()}
              />
              {settings.cloudflareApiTokenPresent && (
                <Button
                  label={t('common.clear')}
                  size="sm"
                  onClick={() => {
                    void window.vav.settings.setCloudflareApiToken('').then(() => {
                      setCfDraft('')
                      void loadAuth()
                    })
                  }}
                />
              )}
            </div>
          </div>
          <div className="form-row">
            <label>{t('workspace.cloudflareAccount')}</label>
            <div className="control">
              <input
                className="text-field"
                placeholder={t('workspace.cloudflareAccountPlaceholder')}
                value={settings.cloudflareAccountId ?? ''}
                onChange={(event) => void updateSettings({ cloudflareAccountId: event.currentTarget.value })}
              />
            </div>
          </div>
        </>
      ) : null}

      <div className="form-row">
        <label>{t('workspace.supabaseTray')}</label>
        <div className="control">
          <Toggle
            checked={settings.supabaseTrayEnabled === true}
            title={t('workspace.supabaseTray')}
            testId="settings-supabase-tray"
            onChange={(supabaseTrayEnabled) => void updateSettings({ supabaseTrayEnabled })}
          />
        </div>
      </div>
      <div className="form-hint">{t('connector.supabase.hint')}</div>
      {renderLogin('supabase')}

      {settings.supabaseTrayEnabled === true ? (
        <>
          <div className="form-row">
            <label>{t('workspace.supabaseToken')}</label>
            <div className="control">
              <input
                className="text-field"
                type="password"
                placeholder={
                  settings.supabaseAccessTokenPresent
                    ? t('workspace.supabaseTokenConfigured')
                    : t('workspace.supabaseTokenPlaceholder')
                }
                value={sbDraft}
                onChange={(event) => setSbDraft(event.currentTarget.value)}
              />
              <Button
                label={sbSaving ? t('workspace.braveSaving') : t('workspace.braveSave')}
                variant="secondary"
                size="sm"
                disabled={sbSaving || !sbDraft.trim()}
                onClick={() => void saveSupabaseToken()}
              />
              {settings.supabaseAccessTokenPresent && (
                <Button
                  label={t('common.clear')}
                  size="sm"
                  onClick={() => {
                    void window.vav.settings.setSupabaseAccessToken('').then(() => {
                      setSbDraft('')
                      void loadAuth()
                    })
                  }}
                />
              )}
            </div>
          </div>
          <div className="form-row">
            <label>{t('workspace.supabaseRef')}</label>
            <div className="control">
              <input
                className="text-field"
                placeholder={t('workspace.supabaseRefPlaceholder')}
                value={settings.supabaseProjectRef ?? ''}
                onChange={(event) => void updateSettings({ supabaseProjectRef: event.currentTarget.value })}
              />
            </div>
          </div>
        </>
      ) : null}

      <div className="form-row">
        <label>{t('workspace.vercelTray')}</label>
        <div className="control">
          <Toggle
            checked={settings.vercelTrayEnabled === true}
            title={t('workspace.vercelTray')}
            testId="settings-vercel-tray"
            onChange={(vercelTrayEnabled) => void updateSettings({ vercelTrayEnabled })}
          />
        </div>
      </div>
      <div className="form-hint">{t('connector.vercel.hint')}</div>
      {renderLogin('vercel')}

      {settings.vercelTrayEnabled === true ? (
        <div className="form-row">
          <label>{t('workspace.vercelToken')}</label>
          <div className="control">
            <input
              className="text-field"
              type="password"
              placeholder={
                settings.vercelApiTokenPresent
                  ? t('workspace.vercelTokenConfigured')
                  : t('workspace.vercelTokenPlaceholder')
              }
              value={vercelDraft}
              onChange={(event) => setVercelDraft(event.currentTarget.value)}
            />
            <Button
              label={vercelSaving ? t('workspace.braveSaving') : t('workspace.braveSave')}
              variant="secondary"
              size="sm"
              disabled={vercelSaving || !vercelDraft.trim()}
              onClick={() => void saveVercelToken()}
            />
            {settings.vercelApiTokenPresent && (
              <Button
                label={t('common.clear')}
                size="sm"
                onClick={() => {
                  void window.vav.settings.setVercelApiToken('').then(() => {
                    setVercelDraft('')
                    void loadAuth()
                  })
                }}
              />
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
