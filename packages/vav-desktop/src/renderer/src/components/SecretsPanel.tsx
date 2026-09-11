import { useCallback, useEffect, useState } from 'react'
import { isValidEnvName } from '@shared/sessionSecrets'
import { EmptyState } from './ui'
import { useSessionStore } from '../state/sessionStore'
import { useT } from '../i18n/useT'
import { showMenu, type MenuItem } from '../lib/nativeMenu'

export type SecretsPanelChrome = {
  startAdd: () => void
}

export function SecretsPanel({
  visible,
  onChrome
}: {
  visible: boolean
  onChrome?: (chrome: SecretsPanelChrome | null) => void
}): React.JSX.Element {
  const t = useT()
  const activeId = useSessionStore((s) => s.activeId)
  const showDialog = useSessionStore((s) => s.showDialog)
  const [names, setNames] = useState<string[]>([])
  const [adding, setAdding] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [draftValue, setDraftValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [revealed, setRevealed] = useState<{ name: string; value: string } | null>(null)

  const load = useCallback(async (id: string): Promise<void> => {
    if (!window.vav?.sessionSecrets?.list) {
      setNames([])
      return
    }
    const row = await window.vav.sessionSecrets.list(id)
    setNames(row?.names ?? [])
  }, [])

  useEffect(() => {
    if (!activeId) {
      setNames([])
      return
    }
    void load(activeId)
    return window.vav.sessionSecrets.onChanged((payload) => {
      if (payload.conversationId === activeId) setNames(payload.names)
    })
  }, [activeId, load])

  const cancelAdd = useCallback((): void => {
    setAdding(false)
    setError(null)
    setDraftName('')
    setDraftValue('')
  }, [])

  const startAdd = useCallback((): void => {
    setAdding(true)
    setError(null)
    setDraftName('')
    setDraftValue('')
  }, [])

  useEffect(() => {
    if (!onChrome) return
    if (!visible) {
      onChrome(null)
      return
    }
    onChrome({ startAdd })
  }, [visible, onChrome, startAdd])

  useEffect(() => () => onChrome?.(null), [onChrome])

  useEffect(() => {
    setRevealed(null)
    setAdding(false)
    setError(null)
  }, [activeId])

  useEffect(() => {
    if (!visible) setRevealed(null)
  }, [visible])

  useEffect(() => {
    if (!revealed) return
    const timer = window.setTimeout(() => setRevealed(null), 30_000)
    return () => window.clearTimeout(timer)
  }, [revealed])

  const mutateError = (code: string | undefined): string => {
    if (code === 'invalid-name') return t('secrets.invalidName')
    if (code === 'empty') return t('secrets.emptyValue')
    if (code === 'limit') return t('secrets.limit')
    return t('common.failed')
  }

  const saveDraft = async (): Promise<void> => {
    if (!activeId) return
    const name = draftName.trim()
    if (!isValidEnvName(name)) {
      setError(t('secrets.invalidName'))
      return
    }
    if (!draftValue.trim()) {
      setError(t('secrets.emptyValue'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await window.vav.sessionSecrets.set(activeId, name, draftValue)
      if (!result.ok) {
        setError(mutateError(result.error))
        return
      }
      setNames(result.names)
      cancelAdd()
    } finally {
      setBusy(false)
    }
  }

  const reveal = async (name: string): Promise<string | null> => {
    if (!activeId) return null
    if (revealed?.name === name) {
      setRevealed(null)
      return revealed.value
    }
    setError(null)
    const result = await window.vav.sessionSecrets.reveal(activeId, name)
    if (!result.ok) {
      if (!result.cancelled) setError(result.error || t('secrets.evalFailed'))
      return null
    }
    setRevealed({ name, value: result.value })
    return result.value
  }

  const copy = async (name: string): Promise<void> => {
    const value = revealed?.name === name ? revealed.value : await reveal(name)
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      setError(t('common.failed'))
    }
  }

  const remove = (name: string): void => {
    if (!activeId) return
    showDialog({
      title: t('secrets.deleteTitle'),
      body: t('secrets.deleteBody', { name }),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      destructive: true,
      onConfirm: () => {
        void window.vav.sessionSecrets.remove(activeId, name).then((result) => {
          if (!result.ok) {
            setError(mutateError(result.error))
            return
          }
          setNames(result.names)
          if (revealed?.name === name) setRevealed(null)
        })
      }
    })
  }

  const rowMenu = (name: string): MenuItem[] => {
    const open = revealed?.name === name
    return [
      {
        label: open ? t('secrets.hide') : t('secrets.show'),
        onSelect: () => void reveal(name)
      },
      {
        label: t('secrets.copy'),
        onSelect: () => void copy(name)
      },
      { label: '', divider: true },
      {
        label: t('common.delete'),
        destructive: true,
        onSelect: () => remove(name)
      }
    ]
  }

  const onPanelContextMenu = (event: React.MouseEvent): void => {
    const target = event.target as HTMLElement
    if (target.closest('input, textarea')) return
    if (target.closest('[data-testid="secrets-row"]')) return
    event.preventDefault()
    event.stopPropagation()
    void showMenu(
      [
        {
          label: t('secrets.add'),
          disabled: adding,
          onSelect: startAdd
        }
      ],
      { x: event.clientX, y: event.clientY }
    )
  }

  if (!visible) return <></>

  return (
    <div className="secrets-panel" data-testid="secrets-panel" onContextMenu={onPanelContextMenu}>
      <p className="secrets-lead">{t('secrets.lead')}</p>
      {error ? (
        <div className="secrets-error" role="alert">
          {error}
        </div>
      ) : null}
      {names.length === 0 && !adding ? (
        <EmptyState title={t('secrets.emptyTitle')} description={t('secrets.emptyDesc')} />
      ) : (
        <ul className="secrets-list">
          {adding ? (
            <li className="secrets-row is-creating">
              <form
                className="secrets-add"
                onSubmit={(event) => {
                  event.preventDefault()
                  void saveDraft()
                }}
              >
                <input
                  className="text-field rename-field secrets-add-name"
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  disabled={busy}
                  placeholder={t('secrets.namePlaceholder')}
                  aria-label={t('secrets.name')}
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Escape') return
                    event.preventDefault()
                    cancelAdd()
                  }}
                />
                <input
                  className="text-field rename-field secrets-add-value"
                  type="password"
                  autoComplete="off"
                  disabled={busy}
                  placeholder={t('secrets.valuePlaceholder')}
                  aria-label={t('secrets.value')}
                  value={draftValue}
                  onChange={(event) => setDraftValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Escape') return
                    event.preventDefault()
                    cancelAdd()
                  }}
                />
              </form>
            </li>
          ) : null}
          {names.map((name) => {
            const open = revealed?.name === name
            return (
              <li
                key={name}
                className="secrets-row"
                data-testid="secrets-row"
                onDoubleClick={() => void reveal(name)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  void showMenu(rowMenu(name), { x: event.clientX, y: event.clientY })
                }}
              >
                <code className="secrets-name">${name}</code>
                {open ? (
                  <span className="secrets-value" title={revealed.value}>
                    {revealed.value}
                  </span>
                ) : (
                  <span className="secrets-mask">••••••••</span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
