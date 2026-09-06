import { useState } from 'react'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'
import { Button, Toggle } from '../ui'

export function ConnectorsSettings(): React.JSX.Element {
  const t = useT()
  const settings = useSessionStore((s) => s.settings)
  const updateSettings = useSessionStore((s) => s.updateSettings)
  const [cfDraft, setCfDraft] = useState('')
  const [cfSaving, setCfSaving] = useState(false)
  const [sbDraft, setSbDraft] = useState('')
  const [sbSaving, setSbSaving] = useState(false)
  const [vercelDraft, setVercelDraft] = useState('')
  const [vercelSaving, setVercelSaving] = useState(false)

  const saveCloudflareToken = async (): Promise<void> => {
    setCfSaving(true)
    try {
      await window.vav.settings.setCloudflareApiToken(cfDraft.trim())
      setCfDraft('')
    } finally {
      setCfSaving(false)
    }
  }

  const saveSupabaseToken = async (): Promise<void> => {
    setSbSaving(true)
    try {
      await window.vav.settings.setSupabaseAccessToken(sbDraft.trim())
      setSbDraft('')
    } finally {
      setSbSaving(false)
    }
  }

  const saveVercelToken = async (): Promise<void> => {
    setVercelSaving(true)
    try {
      await window.vav.settings.setVercelApiToken(vercelDraft.trim())
      setVercelDraft('')
    } finally {
      setVercelSaving(false)
    }
  }

  return (
    <div className="form" data-testid="settings-connectors">
      <div className="form-hint">{t('connector.pageHint')}</div>

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
                    void window.vav.settings.setCloudflareApiToken('').then(() => setCfDraft(''))
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
                    void window.vav.settings.setSupabaseAccessToken('').then(() => setSbDraft(''))
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

      {settings.vercelTrayEnabled === true ? (
        <>
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
                    void window.vav.settings.setVercelApiToken('').then(() => setVercelDraft(''))
                  }}
                />
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
