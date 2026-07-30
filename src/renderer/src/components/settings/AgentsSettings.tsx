import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { DEFAULT_CLI_AGENTS, type AgentConfig } from '@shared/types'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'
import { Button } from '../ui'

/**
 * Built-in CLI agents (Claude Code, Codex, Cursor, Grok, Devin, Pi) are always
 * listed. Users only need the binary on PATH — "Add" is for custom agents only.
 */
export function AgentsSettings(): React.JSX.Element {
  const t = useT()
  const settings = useSessionStore((s) => s.settings)
  const updateSettings = useSessionStore((s) => s.updateSettings)
  // Fall back when legacy settings.json had cliAgents: [].
  const agents =
    settings.cliAgents && settings.cliAgents.length > 0
      ? settings.cliAgents
      : DEFAULT_CLI_AGENTS.map((a) => ({
          ...a,
          envVars: { ...a.envVars },
          defaultArgs: [...a.defaultArgs]
        }))
  const [selectedId, setSelectedId] = useState<string | null>(agents[0]?.id ?? null)
  const selected = useMemo(
    () => agents.find((a) => a.id === selectedId) ?? agents[0] ?? null,
    [agents, selectedId]
  )

  const patchAgent = (id: string, patch: Partial<AgentConfig>): void => {
    const next = agents.map((a) => (a.id === id ? { ...a, ...patch } : a))
    void updateSettings({ cliAgents: next })
  }

  const addCustom = (): void => {
    const id = `custom-${Date.now().toString(36)}`
    const agent: AgentConfig = {
      id,
      name: t('agents.customName'),
      binaryPath: '',
      defaultArgs: [],
      envVars: {},
      enabled: true,
      providerName: null,
      builtin: false
    }
    void updateSettings({ cliAgents: [...agents, agent] })
    setSelectedId(id)
  }

  const removeAgent = (id: string): void => {
    const target = agents.find((a) => a.id === id)
    if (target?.builtin) return // built-ins are not removable
    const next = agents.filter((a) => a.id !== id)
    void updateSettings({
      cliAgents: next,
      defaultAgentId:
        settings.defaultAgentId === id
          ? (next.find((a) => a.enabled)?.id ?? null)
          : settings.defaultAgentId
    })
    if (selectedId === id) setSelectedId(next[0]?.id ?? null)
  }

  return (
    <div className="settings-section agents-settings">
      <p className="muted" style={{ marginBottom: 12 }}>
        {t('agents.intro')}
      </p>
      <div className="agents-layout">
        <div className="agents-list">
          {agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              className={`agents-list-row${agent.id === selected?.id ? ' selected' : ''}${agent.enabled ? '' : ' disabled'}`}
              onClick={() => setSelectedId(agent.id)}
            >
              <span className="agents-list-name">
                {agent.name}
                {agent.builtin ? (
                  <span className="muted tiny" style={{ marginLeft: 6 }}>
                    {t('agents.builtinBadge')}
                  </span>
                ) : null}
              </span>
              <span className="muted tiny">{agent.binaryPath || '—'}</span>
            </button>
          ))}
          <Button
            label={t('agents.addCustom')}
            icon={<Plus size={12} />}
            size="sm"
            variant="secondary"
            onClick={addCustom}
          />
        </div>
        {selected ? (
          <div className="agents-editor">
            <label className="settings-field">
              <span>{t('agents.field.name')}</span>
              <input
                className="text-field"
                value={selected.name}
                disabled={!!selected.builtin}
                onChange={(e) => patchAgent(selected.id, { name: e.target.value })}
              />
            </label>
            <label className="settings-field">
              <span>{t('agents.field.binary')}</span>
              <input
                className="text-field"
                value={selected.binaryPath}
                placeholder="claude"
                onChange={(e) => patchAgent(selected.id, { binaryPath: e.target.value.trim() })}
              />
              <span className="muted tiny" style={{ marginTop: 4 }}>
                {t('agents.field.binaryHint')}
              </span>
            </label>
            <label className="settings-field">
              <span>{t('agents.field.args')}</span>
              <input
                className="text-field"
                value={selected.defaultArgs.join(' ')}
                placeholder="--flag value"
                onChange={(e) =>
                  patchAgent(selected.id, {
                    defaultArgs: e.target.value
                      .split(/\s+/)
                      .map((s) => s.trim())
                      .filter(Boolean)
                  })
                }
              />
            </label>
            <label className="settings-field row">
              <input
                type="checkbox"
                checked={selected.enabled}
                onChange={(e) => patchAgent(selected.id, { enabled: e.target.checked })}
              />
              <span>{t('agents.field.enabled')}</span>
            </label>
            <label className="settings-field row">
              <input
                type="radio"
                name="default-agent"
                checked={settings.defaultAgentId === selected.id}
                onChange={() => void updateSettings({ defaultAgentId: selected.id })}
              />
              <span>{t('agents.field.defaultForSplits')}</span>
            </label>
            {!selected.builtin ? (
              <div className="agents-editor-actions">
                <Button
                  label={t('common.delete')}
                  icon={<Trash2 size={12} />}
                  size="sm"
                  variant="danger"
                  onClick={() => removeAgent(selected.id)}
                />
              </div>
            ) : null}
          </div>
        ) : (
          <div className="muted">{t('agents.empty')}</div>
        )}
      </div>
    </div>
  )
}
