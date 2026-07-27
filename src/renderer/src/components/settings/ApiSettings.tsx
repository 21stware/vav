import { useEffect, useState } from 'react'
import { PRESET_MODELS } from '@shared/types'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'
import { Button } from '../ui'

/**
 * API & model settings.
 *
 * The key is draft state until 完成 or 验证; everything else writes through
 * immediately (settings-api.rpml annotations 4 and 5).
 */
export function ApiSettings({
  onFooterMessage,
  registerCommit
}: {
  onFooterMessage: (message: string) => void
  registerCommit: (commit: (() => Promise<void>) | null) => void
}): React.JSX.Element {
  const t = useT()
  const settings = useSessionStore((s) => s.settings)
  const apiKeyHint = useSessionStore((s) => s.apiKeyHint)
  const updateSettings = useSessionStore((s) => s.updateSettings)
  const refreshApiKeyHint = useSessionStore((s) => s.refreshApiKeyHint)

  const [draftKey, setDraftKey] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [validating, setValidating] = useState(false)
  const [customModel, setCustomModel] = useState('')

  useEffect(() => {
    const commit = async (): Promise<void> => {
      if (!draftKey.trim()) return
      await window.vav.settings.setApiKey(draftKey.trim())
      await refreshApiKeyHint()
    }
    registerCommit(commit)
    return () => registerCommit(null)
  }, [draftKey, registerCommit, refreshApiKeyHint])

  const validate = async (): Promise<void> => {
    setValidating(true)
    onFooterMessage(t('api.validating'))
    const response = await window.vav.settings.validateKey(draftKey.trim())
    onFooterMessage(response.message)
    if (response.ok && draftKey.trim()) {
      await window.vav.settings.setApiKey(draftKey.trim())
      await refreshApiKeyHint()
      setDraftKey('')
    }
    setValidating(false)
  }

  const reveal = async (): Promise<void> => {
    if (revealed) {
      setRevealed(false)
      return
    }
    if (!draftKey) {
      const stored = await window.vav.settings.revealApiKey()
      if (stored) setDraftKey(stored)
    }
    setRevealed(true)
  }

  const models = [...PRESET_MODELS.map((m) => m.id), ...settings.customModels]

  return (
    <div className="form">
      <div className="form-row">
        <label>{t('api.key')}</label>
        <div className="control">
          <input
            className="text-field"
            type={revealed ? 'text' : 'password'}
            placeholder={settings.apiKeyPresent ? '••••••••••••••••' : 'sk-ant-…'}
            value={draftKey}
            onChange={(event) => setDraftKey(event.target.value)}
          />
          <Button
            label={revealed ? t('api.hide') : t('api.show')}
            size="sm"
            onClick={() => void reveal()}
          />
          <Button
            label={validating ? t('api.validating') : t('api.validate')}
            variant="secondary"
            size="sm"
            disabled={validating}
            onClick={() => void validate()}
          />
        </div>
      </div>
      <div className="form-hint">
        {settings.apiKeyPresent
          ? t('api.keyConfigured', { hint: apiKeyHint ?? '••••' })
          : t('api.keyEmpty')}
      </div>

      <div className="form-row">
        <label>{t('api.endpoint')}</label>
        <div className="control">
          <input
            className="text-field"
            value={settings.apiEndpoint}
            onChange={(event) => void updateSettings({ apiEndpoint: event.target.value })}
          />
        </div>
      </div>

      <div className="form-row">
        <label>{t('api.model')}</label>
        <div className="control">
          <select
            className="text-field"
            value={settings.defaultModel}
            onChange={(event) => void updateSettings({ defaultModel: event.target.value })}
          >
            {models.map((id) => (
              <option key={id} value={id}>
                {PRESET_MODELS.find((m) => m.id === id)?.label ?? id}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="form-row">
        <label>{t('api.customModelId')}</label>
        <div className="control">
          <input
            className="text-field"
            placeholder="provider-model-id"
            value={customModel}
            onChange={(event) => setCustomModel(event.target.value)}
          />
          <Button
            label={t('api.addAndUse')}
            variant="secondary"
            size="sm"
            disabled={!customModel.trim()}
            onClick={() => {
              const id = customModel.trim()
              void updateSettings({
                customModels: [...new Set([...settings.customModels, id])],
                defaultModel: id
              })
              setCustomModel('')
            }}
          />
        </div>
      </div>

      <div className="form-row">
        <label>{t('api.maxTokens')}</label>
        <div className="control">
          <input
            className="text-field"
            type="number"
            min={256}
            max={200000}
            step={256}
            value={settings.maxTokens}
            onChange={(event) => void updateSettings({ maxTokens: Number(event.target.value) })}
          />
        </div>
      </div>

      <div className="form-row">
        <label>{t('api.temperature')}</label>
        <div className="control">
          <input
            type="range"
            min={0}
            max={2}
            step={0.1}
            style={{ flex: 1 }}
            value={settings.temperature}
            onChange={(event) => void updateSettings({ temperature: Number(event.target.value) })}
          />
          <span className="muted" style={{ width: 28 }}>
            {settings.temperature.toFixed(1)}
          </span>
        </div>
      </div>
    </div>
  )
}
