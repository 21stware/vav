import { useEffect, useRef, useState } from 'react'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'
import { Button } from '../ui'

/**
 * VAV provider credentials. The key is draft until blur / Validate / unmount
 * persists it. Changing key or endpoint should trigger a live `/models` pull.
 */
export function VavApiCredentials({
  onCredentialsChanged
}: {
  onCredentialsChanged?: () => void
}): React.JSX.Element {
  const t = useT()
  const settings = useSessionStore((s) => s.settings)
  const apiKeyHint = useSessionStore((s) => s.apiKeyHint)
  const updateSettings = useSessionStore((s) => s.updateSettings)
  const refreshApiKeyHint = useSessionStore((s) => s.refreshApiKeyHint)

  const [draftKey, setDraftKey] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [validating, setValidating] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const draftKeyRef = useRef(draftKey)
  draftKeyRef.current = draftKey
  const refreshHintRef = useRef(refreshApiKeyHint)
  refreshHintRef.current = refreshApiKeyHint
  const onChangedRef = useRef(onCredentialsChanged)
  onChangedRef.current = onCredentialsChanged
  const endpointRef = useRef(settings.apiEndpoint)

  const persistDraftKey = async (): Promise<boolean> => {
    const key = draftKeyRef.current.trim()
    if (!key) return false
    await window.vav.settings.setApiKey(key)
    await refreshHintRef.current()
    return true
  }

  useEffect(() => {
    return () => {
      void persistDraftKey().then((wrote) => {
        if (wrote) onChangedRef.current?.()
      })
    }
  }, [])

  const notify = (): void => {
    onChangedRef.current?.()
  }

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
      notify()
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

  return (
    <div className="agents-vav-credentials">
      <label className="settings-field">
        <span>{t('api.key')}</span>
        <div className="control">
          <input
            className="text-field"
            type={revealed ? 'text' : 'password'}
            placeholder={settings.apiKeyPresent ? '••••••••••••••••' : 'sk-…'}
            value={draftKey}
            onChange={(event) => {
              setDraftKey(event.target.value)
              if (status) setStatus(null)
            }}
            onBlur={() => {
              void persistDraftKey().then((wrote) => {
                if (wrote) notify()
              })
            }}
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
      </label>
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

      <label className="settings-field">
        <span>{t('api.endpoint')}</span>
        <div className="control">
          <input
            className="text-field"
            value={settings.apiEndpoint}
            placeholder="https://api.deepseek.com"
            onChange={(event) => {
              endpointRef.current = event.target.value
              void updateSettings({ apiEndpoint: event.target.value })
            }}
            onBlur={() => notify()}
          />
        </div>
      </label>
    </div>
  )
}
