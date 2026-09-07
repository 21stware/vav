import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, FileCode2, FolderOpen, Plug, Puzzle, Sparkles } from 'lucide-react'
import {
  isPluginSnapshot,
  type PluginHook,
  type PluginMcpServer,
  type PluginRecord,
  type PluginSnapshot
} from '@shared/plugins'
import { Button, EmptyState } from './ui'
import { useT } from '../i18n/useT'
import { openFileInSessionPreview } from '../lib/openSessionFile'

export type PluginsPanelChrome = {
  meta: string | null
  loading: boolean
  writable: boolean
  refresh: () => void
}

export type PluginCreateKind = 'skill' | 'mcp' | 'hook' | 'plugin'

interface PluginsPanelProps {
  visible: boolean
  host: string | null | undefined
  onChrome?: (chrome: PluginsPanelChrome | null) => void
}

type PluginFilter = 'all' | 'skill' | 'mcp' | 'hook'

function isPluginError(value: unknown): value is { ok: false; error: string } {
  return Boolean(value && typeof value === 'object' && 'ok' in value && value.ok === false)
}

function pluginFilterHit(plugin: PluginRecord, filter: PluginFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'skill') return plugin.skills.length > 0
  if (filter === 'mcp') return plugin.mcpServers.length > 0
  return plugin.hooks.length > 0
}

function pluginKindKey(plugin: PluginRecord): 'skill' | 'mcp' | 'hook' | 'plugin' {
  const skills = plugin.skills.length
  const mcp = plugin.mcpServers.length
  const hooks = plugin.hooks.length
  if (skills && !mcp && !hooks) return 'skill'
  if (mcp && !skills && !hooks) return 'mcp'
  if (hooks && !skills && !mcp) return 'hook'
  return 'plugin'
}

export function PluginsPanel({
  visible,
  host,
  onChrome
}: PluginsPanelProps): React.JSX.Element {
  const t = useT()
  const [snapshot, setSnapshot] = useState<PluginSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<PluginFilter>('all')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!window.vav?.plugins?.list) {
      setSnapshot(null)
      setError(t('plugins.apiMissing'))
      return
    }
    setLoading(true)
    setError(null)
    try {
      const snap = await window.vav.plugins.list(host)
      if (!isPluginSnapshot(snap)) {
        setSnapshot(null)
        setError(t('plugins.apiMissing'))
        return
      }
      setSnapshot(snap)
      setSelectedId((prev) => {
        if (prev && snap.plugins.some((plugin) => plugin.id === prev)) return prev
        return snap.plugins[0]?.id ?? null
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSnapshot(null)
    } finally {
      setLoading(false)
    }
  }, [host, t])

  useEffect(() => {
    if (!visible) return
    void load()
  }, [visible, load])

  useEffect(() => {
    if (!onChrome) return
    if (!visible) {
      onChrome(null)
      return
    }
    onChrome({
      meta: snapshot ? snapshot.hostLabel : null,
      loading,
      writable: snapshot?.writable === true,
      refresh: () => void load()
    })
  }, [visible, onChrome, snapshot, loading, load])

  useEffect(() => () => onChrome?.(null), [onChrome])

  const selected = useMemo(
    () => snapshot?.plugins.find((plugin) => plugin.id === selectedId) ?? null,
    [snapshot, selectedId]
  )

  const filtered = useMemo(() => {
    const list = snapshot?.plugins ?? []
    return list.filter((plugin) => pluginFilterHit(plugin, filter))
  }, [snapshot, filter])

  const toggleEnabled = async (plugin: PluginRecord): Promise<void> => {
    if (!snapshot?.writable || plugin.readOnly || !window.vav?.plugins?.setEnabled) return
    setBusy(true)
    try {
      const result = await window.vav.plugins.setEnabled(snapshot.host, plugin.id, !plugin.enabled)
      if (isPluginError(result)) {
        setError(result.error)
        return
      }
      if (!isPluginSnapshot(result)) {
        setError(t('plugins.apiMissing'))
        return
      }
      setSnapshot(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const openPath = (path: string | undefined): void => {
    if (!path) return
    openFileInSessionPreview(path)
  }

  const kindLabel = (plugin: PluginRecord): string => {
    const key = pluginKindKey(plugin)
    if (key === 'skill') return t('plugins.kindSkill')
    if (key === 'mcp') return t('plugins.kindMcp')
    if (key === 'hook') return t('plugins.kindHook')
    return t('plugins.kindPlugin')
  }

  if (!visible) return <></>

  if (loading && !snapshot) {
    return (
      <div className="plugins-panel">
        <EmptyState title={t('plugins.loading')} />
      </div>
    )
  }

  if (error && !snapshot) {
    return (
      <div className="plugins-panel">
        <EmptyState title={t('plugins.loadFailed')} description={error} />
      </div>
    )
  }

  if (!snapshot || snapshot.plugins.length === 0) {
    return (
      <div className="plugins-panel">
        <EmptyState
          title={t('plugins.emptyTitle')}
          description={snapshot?.writable ? t('plugins.emptyDescVav') : t('plugins.emptyDescHost')}
        />
      </div>
    )
  }

  return (
    <div className="plugins-panel">
      <header className="plugins-panel-meta">
        <span className="plugins-panel-host" title={snapshot.root}>
          {snapshot.hostLabel}
          {snapshot.root ? ` · ${snapshot.root}` : ''}
        </span>
        {!snapshot.writable && <span className="plugins-panel-hint">{t('plugins.acpReadonly')}</span>}
        {error && <span className="plugins-panel-error">{error}</span>}
      </header>
      <div className="plugins-panel-filters" role="tablist" aria-label={t('plugins.filterAria')}>
        {(['all', 'skill', 'mcp', 'hook'] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={filter === key}
            className={`plugins-filter${filter === key ? ' is-active' : ''}`}
            onClick={() => setFilter(key)}
          >
            {key === 'all'
              ? t('plugins.filterAll')
              : key === 'skill'
                ? t('plugins.kindSkill')
                : key === 'mcp'
                  ? t('plugins.kindMcp')
                  : t('plugins.kindHook')}
          </button>
        ))}
      </div>
      <div className={`plugins-panel-body${selected ? '' : ' is-list-only'}`}>
        <ul className="plugins-list">
          {filtered.map((plugin) => (
            <li key={plugin.id}>
              <button
                type="button"
                className={`plugins-list-item${selectedId === plugin.id ? ' is-selected' : ''}${
                  plugin.enabled ? '' : ' is-disabled'
                }`}
                onClick={() => setSelectedId(plugin.id)}
              >
                <span className="plugins-list-icon" aria-hidden>
                  {pluginIcon(plugin)}
                </span>
                <span className="plugins-list-copy">
                  <span className="plugins-list-name">{plugin.name}</span>
                  <span className="plugins-list-kind">{kindLabel(plugin)}</span>
                </span>
                {plugin.enabled ? (
                  <Check size={12} className="plugins-list-check" aria-hidden />
                ) : null}
              </button>
            </li>
          ))}
        </ul>
        {selected && (
          <article className="plugins-detail">
            <header className="plugins-detail-head">
              <div>
                <h3>{selected.name}</h3>
                {selected.description && <p>{selected.description}</p>}
                {selected.dir && (
                  <p className="plugins-detail-path" title={selected.dir}>
                    {selected.dir}
                  </p>
                )}
              </div>
              {snapshot.writable && !selected.readOnly && (
                <Button
                  size="sm"
                  disabled={busy}
                  label={selected.enabled ? t('plugins.enabled') : t('plugins.disabled')}
                  onClick={() => void toggleEnabled(selected)}
                />
              )}
            </header>
            {selected.skills.length > 0 && (
              <section>
                <h4>{t('plugins.skills')}</h4>
                <ul>
                  {selected.skills.map((skill) => (
                    <li key={skill.id}>
                      <button type="button" onClick={() => openPath(skill.path)}>
                        <Sparkles size={13} aria-hidden />
                        <span>
                          <strong>{skill.name}</strong>
                          {skill.description && <em>{skill.description}</em>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {selected.mcpServers.length > 0 && (
              <section>
                <h4>{t('plugins.mcp')}</h4>
                <ul>
                  {selected.mcpServers.map((server) => (
                    <li key={server.id}>
                      <button type="button" onClick={() => openPath(openTarget(selected, server))}>
                        <Plug size={13} aria-hidden />
                        <span>
                          <strong>{server.name}</strong>
                          <em>{server.command || server.url || server.configPath}</em>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {selected.hooks.length > 0 && (
              <section>
                <h4>{t('plugins.hooks')}</h4>
                <ul>
                  {selected.hooks.map((hook) => (
                    <li key={hook.id}>
                      <button type="button" onClick={() => openPath(openTarget(selected, hook))}>
                        <FileCode2 size={13} aria-hidden />
                        <span>
                          <strong>{hook.event}</strong>
                          <em>{hook.command}</em>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <footer className="plugins-detail-actions">
              <Button
                size="sm"
                icon={<FolderOpen size={14} />}
                label={t('plugins.openSource')}
                onClick={() =>
                  openPath(selected.manifestPath || selected.skills[0]?.path || selected.dir)
                }
              />
            </footer>
          </article>
        )}
      </div>
    </div>
  )
}

function pluginIcon(plugin: PluginRecord): React.JSX.Element {
  const kind = pluginKindKey(plugin)
  if (kind === 'mcp') return <Plug size={14} />
  if (kind === 'hook') return <FileCode2 size={14} />
  if (kind === 'skill') return <Sparkles size={14} />
  return <Puzzle size={14} />
}

function openTarget(
  plugin: PluginRecord,
  item: PluginMcpServer | PluginHook
): string | undefined {
  return item.configPath || plugin.manifestPath || plugin.dir
}
