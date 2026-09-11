import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import type { DbConnection, DbDriver } from '@shared/dbConnection'
import {
  DB_DRIVER_DEFAULTS,
  DB_DRIVERS,
  DB_DRIVER_IMPLEMENTED,
  clampDbPort,
  dbDriverFormKind,
  dbDriverUsesAuth,
  dbDriverUsesSsl,
  dbConnectionTitle,
  dbUrlPlaceholder,
  defaultDbPort,
  formatDbUrl,
  parseDbUrl,
  setDbUrlSsl
} from '@shared/dbConnection'
import { isDefaultSessionTitle } from '@shared/i18n'
import { seedEmptyConversationPatch } from '../state/sessionBootstrap'
import { useSessionStore } from '../state/sessionStore'
import type { MessageKey } from '@shared/i18n'
import { useT } from '../i18n/useT'
import { isDraftDbConnection, isDraftDbTitle } from '../lib/draftEditorTitle'
import { useSidebarFloatMode } from '../lib/sidebarLayout'
import { ShellLeadingControls } from './ShellLeadingControls'
import { Button, Toggle } from './ui'

const DRIVERS: DbDriver[] = [...DB_DRIVERS]

export function DbConnectEditor({
  conversationId,
  onConnected,
  embedded = false
}: {
  conversationId: string | null
  onConnected?: () => void
  /** Form only — used inside the DB workspace preview next to Agent. */
  embedded?: boolean
}): React.JSX.Element {
  const t = useT()
  const conversation = useSessionStore((s) =>
    conversationId ? s.conversations.find((row) => row.id === conversationId) : undefined
  )
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
  const [useUrl, setUseUrl] = useState(false)
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState<'connect' | 'test' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [testedOk, setTestedOk] = useState(false)

  useEffect(() => {
    if (conversationId) return
    setConnection(null)
    setDriver('postgres')
    setHost('localhost')
    setPort(String(defaultDbPort('postgres')))
    setDatabase('')
    setUser('')
    setPassword('')
    setSsl(false)
    setTitle('')
    setError(null)
    setTestedOk(false)
  }, [conversationId])

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
    if (field !== 'db-use-url') setUseUrl(next.useUrl)
    if (field !== 'db-url') setUrl(next.url)
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
    const untitled = t('db.untitled')
    const existing = window.vav.db.list ? await window.vav.db.list() : []
    const draft = existing.find((row) => isDraftDbConnection(row, untitled) && row.conversationId)
    if (draft) {
      setConnection(draft)
      return draft
    }
    if (!window.vav.db.create) {
      setError(t('db.createFailed'))
      return null
    }
    const result = await window.vav.db.create()
    useSessionStore.setState((state) => ({
      ...seedEmptyConversationPatch(state, result.conversation),
      sidebarListMode: 'databases'
    }))
    setConnection(result.connection)
    return result.connection
  }

  const persist = async (
    patch: {
      title?: string
      driver?: DbDriver
      host?: string
      port?: number
      database?: string
      user?: string
      ssl?: boolean
      useUrl?: boolean
      url?: string
      password?: string
    },
    current = connection
  ): Promise<DbConnection | null> => {
    const row = current ?? (await resolveConnection())
    if (!row) {
      setError(t('db.createFailed'))
      return null
    }
    setTestedOk(false)
    if (!window.vav?.db?.update) {
      setError(t('db.saveFailed'))
      return null
    }
    try {
      const nextUseUrl = patch.useUrl ?? useUrl
      const updated = await window.vav.db.update(row.id, {
        title: patch.title ?? title,
        driver: patch.driver ?? driver,
        host: patch.host ?? host,
        port: patch.port ?? clampDbPort(Number(port) || 0, patch.driver ?? driver),
        database: patch.database ?? database,
        user: patch.user ?? user,
        ssl: patch.ssl ?? ssl,
        useUrl: nextUseUrl,
        ...(nextUseUrl || patch.url !== undefined ? { url: patch.url ?? url } : {}),
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

  const saveCurrent = async (): Promise<DbConnection | null> => {
    if (useUrl && !parseDbUrl(url, driver)) {
      setError(t('db.urlInvalid'))
      return null
    }
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
      const named = title.trim()
      if (named && sessionId && !isDraftDbTitle(named, t('db.untitled')) && named !== conversation?.title) {
        await renameConversation(sessionId, named)
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
      let opened = saved
      if (window.vav.db.open) {
        const next = await window.vav.db.open(saved.id)
        if (!next) {
          setError(t('db.connectFailed'))
          return
        }
        opened = next
        setConnection(next)
      }
      setPassword('')
      const sessionId = opened.conversationId ?? conversationId
      const untitled = t('db.untitled')
      const display = dbConnectionTitle({
        ...opened,
        title: isDraftDbTitle(title, untitled) ? '' : title
      })
      if (isDraftDbTitle(title, untitled) || !title.trim()) {
        setTitle(display)
        if (isDraftDbTitle(opened.title, untitled) || isDefaultSessionTitle(opened.title)) {
          await persist({ title: '' }, opened)
        }
        if (sessionId && display && display !== conversation?.title) {
          await renameConversation(sessionId, display)
        }
      }
      if (sessionId && sessionId !== conversationId) {
        await selectConversation(sessionId)
      }
      onConnected?.()
    } catch (err) {
      const description = err instanceof Error ? err.message : String(err)
      setError(description)
      showToast({
        kind: 'error',
        title: t('db.connectFailed'),
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


  const body = (
      <div className={`db-connect-body${embedded ? ' is-embedded' : ''}`}>
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
              onChange={(event) => {
                const next = event.currentTarget.value
                setTitle(next)
                void persist({ title: next })
              }}
              onFocus={(event) => {
                if (isDraftDbTitle(event.currentTarget.value, t('db.untitled'))) {
                  event.currentTarget.select()
                }
              }}
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
                    if (dbDriverFormKind(next) !== 'server') {
                      setHost('')
                      setSsl(false)
                    } else if (!host.trim()) {
                      setHost('localhost')
                    }
                    void persist({
                      driver: next,
                      port: defaultDbPort(next),
                      host: dbDriverFormKind(next) === 'server' ? host || 'localhost' : '',
                      ssl: dbDriverUsesSsl(next) ? ssl : false
                    })
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

            <label className="settings-field row">
              <span>{t('db.useUrl')}</span>
              <Toggle
                checked={useUrl}
                title={t('db.useUrl')}
                testId="db-use-url"
                onChange={(next) => {
                  setUseUrl(next)
                  if (next) {
                    const nextUrl =
                      url.trim() ||
                      formatDbUrl({
                        driver,
                        host,
                        port: Number(port) || defaultDbPort(driver),
                        database,
                        user,
                        ssl
                      })
                    setUrl(nextUrl)
                    void persist({ useUrl: true, url: nextUrl }).then(() => {
                      document.querySelector<HTMLInputElement>('[data-testid="db-url"]')?.focus()
                    })
                    return
                  }
                  const parsed = parseDbUrl(url, driver)
                  if (parsed) {
                    setHost(parsed.host)
                    setPort(String(parsed.port))
                    setDatabase(parsed.database)
                    setUser(parsed.user)
                    setSsl(parsed.ssl)
                    void persist({
                      useUrl: false,
                      host: parsed.host,
                      port: parsed.port,
                      database: parsed.database,
                      user: parsed.user,
                      ssl: parsed.ssl
                    })
                  } else {
                    void persist({ useUrl: false })
                  }
                  requestAnimationFrame(() => {
                    document
                      .querySelector<HTMLInputElement>(
                        driver === 'duckdb' ? '[data-testid="db-database"]' : '[data-testid="db-host"]'
                      )
                      ?.focus()
                  })
                }}
              />
            </label>

            {useUrl ? (
              <label className="settings-field">
                <span>{t('db.url')}</span>
                <input
                  className="text-field"
                  data-testid="db-url"
                  value={url}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={dbUrlPlaceholder(driver)}
                  onChange={(event) => {
                    const next = event.currentTarget.value
                    setUrl(next)
                    const parsed = parseDbUrl(next, driver)
                    if (parsed) {
                      setHost(parsed.host)
                      setPort(String(parsed.port))
                      setDatabase(parsed.database)
                      setUser(parsed.user)
                      setSsl(parsed.ssl)
                    }
                    void persist({ url: next, useUrl: true })
                  }}
                />
              </label>
            ) : (
              <DbFields
                driver={driver}
                host={host}
                port={port}
                database={database}
                user={user}
                password={password}
                hasPassword={connection?.hasPassword === true}
                t={t}
                onHost={(next) => {
                  setHost(next)
                  void persist({ host: next })
                }}
                onPort={(next) => {
                  if (next !== '' && !/^\d{1,5}$/.test(next)) return
                  setPort(next)
                  if (next) void persist({ port: clampDbPort(Number(next) || 0, driver) })
                }}
                onDatabase={(next) => {
                  setDatabase(next)
                  void persist({ database: next })
                }}
                onUser={(next) => {
                  setUser(next)
                  void persist({ user: next })
                }}
                onPassword={(next) => {
                  setPassword(next)
                  if (next) void persist({ password: next })
                }}
              />
            )}

            {dbDriverUsesSsl(driver) ? (
              <label className="settings-field row">
                <span>{t('db.ssl')}</span>
                <Toggle
                  checked={ssl}
                  title={t('db.ssl')}
                  testId="db-ssl"
                  onChange={(next) => {
                    setSsl(next)
                    if (useUrl) {
                      const nextUrl = setDbUrlSsl(url, next, driver)
                      setUrl(nextUrl)
                      void persist({ ssl: next, url: nextUrl, useUrl: true })
                      return
                    }
                    void persist({ ssl: next })
                  }}
                />
              </label>
            ) : null}
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
  )

  if (embedded) {
    return (
      <div className="db-connect-embedded" data-testid="db-connect-editor">
        {body}
      </div>
    )
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
      {body}
    </main>
  )
}

function DbFields({
  driver,
  host,
  port,
  database,
  user,
  password,
  hasPassword,
  t,
  onHost,
  onPort,
  onDatabase,
  onUser,
  onPassword
}: {
  driver: DbDriver
  host: string
  port: string
  database: string
  user: string
  password: string
  hasPassword: boolean
  t: (key: MessageKey) => string
  onHost: (next: string) => void
  onPort: (next: string) => void
  onDatabase: (next: string) => void
  onUser: (next: string) => void
  onPassword: (next: string) => void
}): React.JSX.Element {
  const kind = dbDriverFormKind(driver)
  const pickFile = async (): Promise<void> => {
    const picked = await window.vav.files?.pickAttachments()
    if (!picked || !('ok' in picked) || !picked.ok || !picked.paths[0]) return
    onDatabase(picked.paths[0])
  }

  return (
    <>
      {kind === 'server' ? (
        <div className="db-connect-row">
          <label className="settings-field">
            <span>{t('db.host')}</span>
            <input
              className="text-field"
              data-testid="db-host"
              value={host}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => onHost(event.currentTarget.value)}
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
              onChange={(event) => onPort(event.currentTarget.value)}
            />
          </label>
        </div>
      ) : kind === 'cloud' ? (
        <label className="settings-field">
          <span>{t('db.location')}</span>
          <input
            className="text-field"
            data-testid="db-host"
            value={host}
            autoComplete="off"
            spellCheck={false}
            placeholder="US"
            onChange={(event) => onHost(event.currentTarget.value)}
          />
        </label>
      ) : null}

      <label className="settings-field">
        <span>
          {kind === 'file' ? t('db.file') : kind === 'cloud' ? t('db.project') : t('db.database')}
        </span>
        <div className={kind === 'file' ? 'db-connect-row' : undefined}>
          <input
            className="text-field"
            data-testid="db-database"
            value={database}
            autoComplete="off"
            spellCheck={false}
            placeholder={kind === 'file' ? '/path/to/file.duckdb' : ''}
            onChange={(event) => onDatabase(event.currentTarget.value)}
          />
          {kind === 'file' ? (
            <Button
              label={t('db.browse')}
              variant="secondary"
              testId="db-browse"
              onClick={() => void pickFile()}
            />
          ) : null}
        </div>
      </label>

      {dbDriverUsesAuth(driver) ? (
        <div className="db-connect-row db-connect-row-split">
          <label className="settings-field">
            <span>{kind === 'cloud' ? t('db.dataset') : t('db.user')}</span>
            <input
              className="text-field"
              data-testid="db-user"
              value={user}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => onUser(event.currentTarget.value)}
            />
          </label>
          <label className="settings-field">
            <span>{kind === 'cloud' ? t('db.credentials') : t('db.password')}</span>
            <input
              className="text-field"
              data-testid="db-password"
              type="password"
              value={password}
              autoComplete="new-password"
              placeholder={hasPassword ? t('db.passwordKept') : ''}
              onChange={(event) => onPassword(event.currentTarget.value)}
            />
          </label>
        </div>
      ) : null}
    </>
  )
}
