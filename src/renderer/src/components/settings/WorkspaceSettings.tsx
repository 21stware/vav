import { useState } from 'react'
import type { ShellKind } from '@shared/types'
import { shellsFor } from '@shared/platform'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'
import { Button, Segmented, Toggle } from '../ui'
import { PLATFORM } from '../../lib/platform'

const SHELLS = shellsFor(PLATFORM)

type WebSearchProvider = 'auto' | 'duckduckgo' | 'searxng' | 'brave'

export function WorkspaceSettings(): React.JSX.Element {
  const t = useT()
  const settings = useSessionStore((s) => s.settings)
  const updateSettings = useSessionStore((s) => s.updateSettings)
  const [braveDraft, setBraveDraft] = useState('')
  const [braveSaving, setBraveSaving] = useState(false)

  const provider = (settings.webSearchProvider ?? 'auto') as WebSearchProvider
  const providerOptions: { value: WebSearchProvider; label: string }[] = [
    { value: 'auto', label: t('workspace.webProviderAuto') },
    { value: 'duckduckgo', label: t('workspace.webProviderDdg') },
    { value: 'searxng', label: t('workspace.webProviderSearx') },
    { value: 'brave', label: t('workspace.webProviderBrave') }
  ]

  const saveBraveKey = async (): Promise<void> => {
    setBraveSaving(true)
    try {
      await window.vav.settings.setBraveSearchKey(braveDraft.trim())
      setBraveDraft('')
    } finally {
      setBraveSaving(false)
    }
  }

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
            title={t('workspace.autoApprove')}
            onChange={(autoApproveReadonly) => void updateSettings({ autoApproveReadonly })}
          />
        </div>
      </div>
      <div className="form-hint">{t('workspace.autoApproveHint')}</div>

      <div className="form-hint">{t('workspace.webToolsHint')}</div>

      <div className="form-row">
        <label>{t('workspace.webTimeout')}</label>
        <div className="control">
          <input
            type="range"
            min={5}
            max={60}
            step={1}
            style={{ flex: 1 }}
            value={Math.round((settings.webTimeoutMs ?? 15_000) / 1000)}
            onChange={(event) =>
              void updateSettings({ webTimeoutMs: Number(event.target.value) * 1000 })
            }
          />
          <span className="muted" style={{ width: 52 }}>
            {t('workspace.timeoutSeconds', {
              n: Math.round((settings.webTimeoutMs ?? 15_000) / 1000)
            })}
          </span>
        </div>
      </div>

      <div className="form-row">
        <label>{t('workspace.webProvider')}</label>
        <div className="control">
          <Segmented<WebSearchProvider>
            options={providerOptions}
            value={provider}
            onChange={(webSearchProvider) => void updateSettings({ webSearchProvider })}
          />
        </div>
      </div>
      <div className="form-hint">{t('workspace.webProviderHint')}</div>

      <div className="form-row">
        <label>{t('workspace.braveKey')}</label>
        <div className="control">
          <input
            className="text-field"
            type="password"
            placeholder={
              settings.braveSearchKeyPresent
                ? t('workspace.braveKeyConfigured')
                : t('workspace.braveKeyPlaceholder')
            }
            value={braveDraft}
            onChange={(event) => setBraveDraft(event.target.value)}
          />
          <Button
            label={braveSaving ? t('workspace.braveSaving') : t('workspace.braveSave')}
            variant="secondary"
            size="sm"
            disabled={braveSaving || !braveDraft.trim()}
            onClick={() => void saveBraveKey()}
          />
          {settings.braveSearchKeyPresent && (
            <Button
              label={t('common.clear')}
              size="sm"
              onClick={() => {
                void window.vav.settings.setBraveSearchKey('').then(() => setBraveDraft(''))
              }}
            />
          )}
        </div>
      </div>
      <div className="form-hint">{t('workspace.braveKeyHint')}</div>

      <div className="form-row">
        <label>{t('workspace.searxng')}</label>
        <div className="control">
          <input
            className="text-field"
            placeholder={t('workspace.searxngPlaceholder')}
            value={settings.webSearxngBaseUrl ?? ''}
            onChange={(event) => void updateSettings({ webSearxngBaseUrl: event.target.value })}
          />
        </div>
      </div>
      <div className="form-hint">{t('workspace.searxngHint')}</div>

      <div className="form-row">
        <label>{t('workspace.webRender')}</label>
        <div className="control">
          <Toggle
            checked={settings.webFetchAllowRender ?? false}
            title={t('workspace.webRender')}
            onChange={(webFetchAllowRender) => void updateSettings({ webFetchAllowRender })}
          />
        </div>
      </div>
      <div className="form-hint">{t('workspace.webRenderHint')}</div>

      <div className="form-hint">{t('workspace.securityHint')}</div>
    </div>
  )
}
