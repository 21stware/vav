import { useEffect, useRef, useState } from 'react'
import { PRESET_MODELS } from '@shared/types'
import { resolveMaxTokens } from '@shared/tokenUsage'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'
import { Button } from '../ui'

/**
 * API & model settings.
 *
 * The key is draft until blur / Validate / unmount persists it; everything else
 * writes through immediately. Connectivity results render inline under the key
 * row (not a settings footer bar).
 */
export function ApiSettings(): React.JSX.Element {
  const t = useT()
  const settings = useSessionStore((s) => s.settings)
  const apiKeyHint = useSessionStore((s) => s.apiKeyHint)
  const updateSettings = useSessionStore((s) => s.updateSettings)
  const refreshApiKeyHint = useSessionStore((s) => s.refreshApiKeyHint)

  const [draftKey, setDraftKey] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [validating, setValidating] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [customModel, setCustomModel] = useState('')
  const draftKeyRef = useRef(draftKey)
  draftKeyRef.current = draftKey
  const refreshHintRef = useRef(refreshApiKeyHint)
  refreshHintRef.current = refreshApiKeyHint

  const persistDraftKey = async (): Promise<void> => {
    const key = draftKeyRef.current.trim()
    if (!key) return
    await window.vav.settings.setApiKey(key)
    await refreshHintRef.current()
  }

  // Flush typed key when leaving this pane / closing the window.
  useEffect(() => {
    return () => {
      void persistDraftKey()
    }
  }, [])

  const validate = async (): Promise<void> => {
    setValidating(true)
    setStatus(t('api.validating'))
    const key = draftKeyRef.current.trim()
    const response = await window.vav.settings.validateKey(key)
    setStatus(response.message)
    if (response.ok && key) {
      await window.vav.settings.setApiKey(key)
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
            onChange={(event) => {
              setDraftKey(event.target.value)
              if (status) setStatus(null)
            }}
            onBlur={() => void persistDraftKey()}
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
      {status ? (
        <div className="form-hint api-validate-status" role="status">
          {status}
        </div>
      ) : null}

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
        <div className="control" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
          <span className="muted">
            {t('api.maxTokensValue', {
              n: resolveMaxTokens(settings.defaultModel).toLocaleString('en-US')
            })}
          </span>
          <span className="muted">{t('api.maxTokensHint')}</span>
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
