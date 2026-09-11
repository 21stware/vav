import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import type { DbConnection, DbDriver } from '@shared/dbConnection'
import {
  DB_DRIVER_DEFAULTS,
  DB_DRIVERS,
  DB_DRIVER_IMPLEMENTED,
  clampDbPort,
  defaultDbPort
} from '@shared/dbConnection'
import { useSessionStore } from '../state/sessionStore'
import { useT } from '../i18n/useT'
import { isDraftDbTitle } from '../lib/draftEditorTitle'
import { useSidebarFloatMode } from '../lib/sidebarLayout'
import { ShellLeadingControls } from './ShellLeadingControls'
import { Button, Toggle } from './ui'

const DRIVERS: DbDriver[] = [...DB_DRIVERS]

export function DbConnectEditor({
  conversationId,
  onConnected
}: {
  conversationId: string | null
  onConnected?: () => void
}): React.JSX.Element {
  const t = useT()
  const conversation = useSessionStore((s) =>
    conversationId ? s.conversations.find((row) => row.id === conversationId) : undefined
  )
  const ensureDbConversation = useSessionStore((s) => s.ensureDbConversation)
  const selectConversation = useSessionStore((s) => s.selectConversation)
  const renameConversation = useSessionStore((s) => s.renameConversation)
  const showToast = useSessionStore((s) => s.showToast)
  const sidebarVisible = useSessionStore((s) => s.sidebarVisible)
  const sidebarFloating = useSidebarFloatMode()
  const showShellLeading = !(sidebarVisible && !sidebarFloating)

  const [connection, setConnection] = useState<DbConnection | null>(null)
  const [driver, setDriver] = useState<DbDriver>('postgres')
  const [host, setHost] = useState('localhost')
  const [port, setPort] = useState(String(defaultDbPort('postgres')))
  const [database, setDatabase] = useState('')
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [ssl, setSsl] = useState(false)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState<'connect' | 'test' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [testedOk, setTestedOk] = useState(false)

  useEffect(() => {
    if (!conversationId) ensureDbConversation()
  }, [conversationId, ensureDbConversation])

  const load = useCallback(async (): Promise<DbConnection | null> => {
    if (!conversationId || !window.vav?.db?.getForConversation) {
      setConnection(null)
      return null
    }
    const next = await window.vav.db.getForConversation(conversationId)
    setConnection(next)
    if (!next) return null
    const active = document.activeElement
    const field =
      active instanceof HTMLInputElement || active instanceof HTMLSelectElement
        ? active.dataset.testid
        : null
    if (field !== 'db-title') setTitle(next.title)
    if (field !== 'db-driver') setDriver(next.driver)
    if (field !== 'db-host') setHost(next.host)
    if (field !== 'db-port') setPort(String(next.port))
    if (field !== 'db-database') setDatabase(next.database)
    if (field !== 'db-user') setUser(next.user)
    if (field !== 'db-ssl') setSsl(next.ssl)
    return next
  }, [conversationId])

  useEffect(() => {
    void load()
    return window.vav.db?.onChanged(() => {
      void load()
    })
  }, [load])

  useEffect(() => {
    document.querySelector<HTMLInputElement>('[data-testid="db-host"]')?.focus()
  }, [])

  const persist = async (
    patch: {
      title?: string
      driver?: DbDriver
      host?: string
      port?: number
      database?: string
      user?: string
      ssl?: boolean
      password?: string
    },
    current = connection
  ): Promise<DbConnection | null> => {
    if (!current) return null
    setTestedOk(false)
    if (!window.vav?.db?.update) {
      setError(t('db.saveFailed'))
      return null
    }
    try {
      const updated = await window.vav.db.update(current.id, {
        title: patch.title ?? title,
        driver: patch.driver ?? driver,
        host: patch.host ?? host,
        port: patch.port ?? clampDbPort(Number(port) || 0, patch.driver ?? driver),
        database: patch.database ?? database,
        user: patch.user ?? user,
        ssl: patch.ssl ?? ssl,
        ...(patch.password !== undefined ? { password: patch.password } : {})
      })
      if (updated) setConnection(updated)
      return updated
    } catch (err) {
      const description = err instanceof Error ? err.message : String(err)
      setError(description)
      showToast({
        kind: 'error',
        title: t('db.saveFailed'),
        description
      })
      return null
    }
  }

  const resolveConnection = async (): Promise<DbConnection | null> => {
    if (connection) return connection
    if (!window.vav?.db) {
      setError(t('db.createFailed'))
      return null
    }
    if (conversationId && window.vav.db.ensureForConversation) {
      const ensured = await window.vav.db.ensureForConversation(conversationId)
      if (ensured) {
        setConnection(ensured)
        return ensured
      }
    }
    if (!window.vav.db.create) {
      setError(t('db.createFailed'))
      return null
    }
    const result = await window.vav.db.create()
    setConnection(result.connection)
    return result.connection
  }

  const saveCurrent = async (): Promise<DbConnection | null> => {
    const current = await resolveConnection()
    if (!current) {
      setError(t('db.createFailed'))
      return null
    }
    const saved = await persist(
      {
        password: password || undefined
      },
      current
    )
    if (!saved) {
      setError((prev) => prev ?? t('db.saveFailed'))
      return null
    }
    const sessionId = saved.conversationId ?? conversationId
    if (title.trim() && sessionId && title.trim() !== conversation?.title) {
      await renameConversation(sessionId, title.trim())
    }
    return saved
  }

  const connect = async (): Promise<void> => {
    if (busy) return
    setBusy('connect')
    setError(null)
    setTestedOk(false)
    try {
      const saved = await saveCurrent()
      if (!saved) return
      if (window.vav.db.open) {
        const opened = await window.vav.db.open(saved.id)
        if (opened) setConnection(opened)
      }
      setPassword('')
      const sessionId = saved.conversationId ?? conversationId
      if (sessionId && sessionId !== conversationId) {
        await selectConversation(sessionId)
      }
      onConnected?.()
    } catch (err) {
      const description = err instanceof Error ? err.message : String(err)
      setError(description)
      showToast({
        kind: 'error',
        title: t('db.saveFailed'),
        description
      })
    } finally {
      setBusy(null)
    }
  }

  const testConnection = async (): Promise<void> => {
    if (busy) return
    setBusy('test')
    setError(null)
    setTestedOk(false)
    try {
      const saved = await saveCurrent()
      if (!saved) return
      if (!window.vav?.db?.test) {
        setError(t('db.testFailed'))
        return
      }
      const result = await window.vav.db.test(saved.id)
      if (!result.ok) {
        const description = result.error || t('db.testFailed')
        setError(description)
        return
      }
      setTestedOk(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault()
    void connect()
  }


  return (
    <main className="detail" data-testid="db-connect-editor">
      <header
        className={`terminal-host-chrome agent-mode-chrome${showShellLeading ? ' has-shell-leading' : ''}`}
      >
        <div className="agent-mode-chrome-row">
          {showShellLeading ? (
            <div className="agent-mode-shell-leading">
              <ShellLeadingControls />
            </div>
          ) : null}
          <span className="spacer" />
        </div>
      </header>

      <div className="db-connect-body">
        <form className="db-connect-card" onSubmit={onSubmit}>
          <div className="db-connect-intro">
            <input
              className={`text-field db-connect-title${
                isDraftDbTitle(title, t('db.untitled')) ? ' is-untitled' : ''
              }`}
              data-testid="db-title"
              value={title}
              placeholder={t('db.untitled')}
              autoComplete="off"
              spellCheck={false}
              aria-label={t('db.name')}
              onChange={(event) => setTitle(event.currentTarget.value)}
              onFocus={(event) => {
                if (isDraftDbTitle(event.currentTarget.value, t('db.untitled'))) {
                  event.currentTarget.select()
                }
              }}
              onBlur={() => void persist({ title })}
            />
          </div>

          <div className="settings-form">
            <label className="settings-field">
              <span>{t('db.driver')}</span>
              <div className="font-select">
                <select
                  className="text-field font-select-field"
                  data-testid="db-driver"
                  aria-label={t('db.driver')}
                  value={driver}
                  onChange={(event) => {
                    const next = event.currentTarget.value as DbDriver
                    if (!DB_DRIVER_IMPLEMENTED.includes(next)) return
                    setDriver(next)
                    const nextPort = String(defaultDbPort(next))
                    setPort(nextPort)
                    void persist({ driver: next, port: defaultDbPort(next) })
                  }}
                >
                  {DRIVERS.map((item) => (
                    <option
                      key={item}
                      value={item}
                      disabled={!DB_DRIVER_IMPLEMENTED.includes(item)}
                      data-testid={`db-driver-${item}`}
                    >
                      {DB_DRIVER_DEFAULTS[item].label}
                      {!DB_DRIVER_IMPLEMENTED.includes(item) ? ` · ${t('db.driverSoon')}` : ''}
                    </option>
                  ))}
                </select>
                <ChevronDown className="font-select-chevron" size={14} strokeWidth={2} aria-hidden />
              </div>
            </label>

            <div className="db-connect-row">
              <label className="settings-field">
                <span>{t('db.host')}</span>
                <input
                  className="text-field"
                  data-testid="db-host"
                  value={host}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setHost(event.currentTarget.value)}
                  onBlur={() => void persist({ host })}
                />
              </label>
              <label className="settings-field">
                <span>{t('db.port')}</span>
                <input
                  className="text-field"
                  data-testid="db-port"
                  inputMode="numeric"
                  autoComplete="off"
                  spellCheck={false}
                  value={port}
                  onChange={(event) => {
                    const next = event.currentTarget.value
                    if (next === '' || /^\d{1,5}$/.test(next)) setPort(next)
                  }}
                  onBlur={() => {
                    const next = String(clampDbPort(Number(port) || 0, driver))
                    setPort(next)
                    void persist({ port: Number(next) })
                  }}
                />
              </label>
            </div>

            <label className="settings-field">
              <span>{t('db.database')}</span>
              <input
                className="text-field"
                data-testid="db-database"
                value={database}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setDatabase(event.currentTarget.value)}
                onBlur={() => void persist({ database })}
              />
            </label>

            <div className="db-connect-row db-connect-row-split">
              <label className="settings-field">
                <span>{t('db.user')}</span>
                <input
                  className="text-field"
                  data-testid="db-user"
                  value={user}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setUser(event.currentTarget.value)}
                  onBlur={() => void persist({ user })}
                />
              </label>
              <label className="settings-field">
                <span>{t('db.password')}</span>
                <input
                  className="text-field"
                  data-testid="db-password"
                  type="password"
                  value={password}
                  autoComplete="new-password"
                  placeholder={connection?.hasPassword ? t('db.passwordKept') : ''}
                  onChange={(event) => setPassword(event.currentTarget.value)}
                  onBlur={() => {
                    if (password) void persist({ password })
                  }}
                />
              </label>
            </div>

            <label className="settings-field row">
              <span>{t('db.ssl')}</span>
              <Toggle
                checked={ssl}
                title={t('db.ssl')}
                testId="db-ssl"
                onChange={(next) => {
                  setSsl(next)
                  void persist({ ssl: next })
                }}
              />
            </label>
          </div>

          <div className="db-connect-actions">
            <Button
              label={busy === 'connect' ? t('db.connecting') : t('db.connect')}
              variant="primary"
              type="submit"
              disabled={busy !== null}
              testId="db-connect"
              className="db-connect-submit"
            />
            <Button
              label={busy === 'test' ? t('db.testing') : t('db.test')}
              variant="secondary"
              disabled={busy !== null}
              testId="db-test"
              className="db-connect-test"
              onClick={() => void testConnection()}
            />
          </div>

          {error ? (
            <p className="db-connect-status is-error" data-testid="db-connect-error">
              {error}
            </p>
          ) : testedOk ? (
            <p className="db-connect-status is-ok" data-testid="db-connect-ok">
              {t('db.connected')}
            </p>
          ) : null}
        </form>
      </div>
    </main>
  )
}
