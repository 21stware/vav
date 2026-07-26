import { useEffect, useState } from 'react'
import { PRESET_MODELS } from '@shared/types'
import { useSessionStore } from '../../state/sessionStore'
import { Button, InlineAlert } from '../ui'

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
  const settings = useSessionStore((s) => s.settings)
  const apiKeyHint = useSessionStore((s) => s.apiKeyHint)
  const updateSettings = useSessionStore((s) => s.updateSettings)
  const refreshApiKeyHint = useSessionStore((s) => s.refreshApiKeyHint)

  const [draftKey, setDraftKey] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [validating, setValidating] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
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
    onFooterMessage('验证中…')
    const response = await window.vav.settings.validateKey(draftKey.trim())
    setResult(response)
    onFooterMessage(response.message)
    if (response.ok && draftKey.trim()) {
      // A key that just proved itself is worth persisting immediately.
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
        <label>API Key</label>
        <div className="control">
          <input
            className="text-field"
            type={revealed ? 'text' : 'password'}
            placeholder={settings.apiKeyPresent ? '••••••••••••••••' : 'sk-ant-…'}
            value={draftKey}
            onChange={(event) => setDraftKey(event.target.value)}
          />
          <Button label={revealed ? '隐藏' : '显示'} size="sm" onClick={() => void reveal()} />
          <Button
            label={validating ? '验证中…' : '验证'}
            variant="secondary"
            size="sm"
            disabled={validating}
            onClick={() => void validate()}
          />
        </div>
      </div>
      <div className="form-hint">
        {settings.apiKeyPresent
          ? `已配置：${apiKeyHint ?? '••••'} · 输入新密钥以替换。密钥仅存本机 Keychain。`
          : '尚未配置。密钥仅存本机 Keychain，不写入会话记录。'}
      </div>

      <div className="form-row">
        <label>API 端点</label>
        <div className="control">
          <input
            className="text-field"
            value={settings.apiEndpoint}
            onChange={(event) => void updateSettings({ apiEndpoint: event.target.value })}
          />
        </div>
      </div>

      <div className="form-row">
        <label>默认模型</label>
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
        <label>自定义模型 ID</label>
        <div className="control">
          <input
            className="text-field"
            placeholder="provider-model-id"
            value={customModel}
            onChange={(event) => setCustomModel(event.target.value)}
          />
          <Button
            label="添加并使用"
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
        <label>最大 Token</label>
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
        <label>温度</label>
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

      {result && (
        <InlineAlert
          kind={result.ok ? 'success' : 'error'}
          title={result.ok ? '验证成功' : '验证失败'}
          message={result.message}
        />
      )}

      <InlineAlert
        kind="info"
        title="提示"
        message="401 通常是密钥错误、未保存，或端点与提供商不匹配。验证通过后再开始会话。"
      />
    </div>
  )
}
