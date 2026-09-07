import { useCallback, useEffect, useState } from 'react'
import { Check, FileText, Loader2, Plus } from 'lucide-react'
import type { FileAssociationStatus } from '@shared/ipc'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'
import { PLATFORM } from '../../lib/platform'
import { Button, InlineAlert } from '../ui'

/**
 * Register vav as the default opener for supported formats
 * (settings-file-associations.rpml).
 */
export function FileAssociationsSettings(): React.JSX.Element {
  const t = useT()
  const showDialog = useSessionStore((s) => s.showDialog)
  const [rows, setRows] = useState<FileAssociationStatus[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [registering, setRegistering] = useState(false)
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setRows(await window.vav.settings.fileAssociations())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (PLATFORM !== 'darwin' && PLATFORM !== 'win32') {
    return (
      <div className="settings-form">
        <InlineAlert kind="warning" message={t('assoc.unsupportedPlatform')} />
      </div>
    )
  }

  if (!rows) {
    return (
      <div className="muted" data-testid="settings-assoc">
        {t('common.loading')}
      </div>
    )
  }

  const intro = PLATFORM === 'win32' ? t('assoc.introWin') : t('assoc.intro')

  const p0 = rows.filter((r) => r.tier === 'p0')
  const p1 = rows.filter((r) => r.tier === 'p1')

  const confirmSet = (row: FileAssociationStatus): void => {
    if (row.isVav) return
    showDialog({
      title: t('assoc.setTitle', { label: row.label }),
      body:
        PLATFORM === 'win32'
          ? t('assoc.setBodyWin', {
              label: row.label,
              ext: row.extensions.join(', '),
              current: row.defaultApp || t('assoc.unset')
            })
          : t('assoc.setBody', {
              label: row.label,
              ext: row.extensions.join(', '),
              current: row.defaultApp || t('assoc.unset')
            }),
      confirmLabel: PLATFORM === 'win32' ? t('assoc.openSystemDefaults') : t('assoc.setAsDefault'),
      onConfirm: () => {
        void (async () => {
          setBusyId(row.id)
          setStatus(null)
          try {
            await window.vav.settings.setFileAssociation(row.id)
            await refresh()
            setStatus({
              tone: 'ok',
              text:
                PLATFORM === 'win32'
                  ? t('assoc.setSuccessWin', { label: row.label })
                  : t('assoc.setSuccess', { label: row.label })
            })
          } catch (err) {
            setStatus({
              tone: 'error',
              text: `${t('assoc.setFailed')} ${(err as Error).message}`.trim()
            })
          } finally {
            setBusyId(null)
          }
        })()
      }
    })
  }

  const confirmUnset = (row: FileAssociationStatus): void => {
    if (!row.isVav) return
    showDialog({
      title: t('assoc.unsetTitle', { label: row.label }),
      body: t('assoc.unsetBody', { label: row.label }),
      confirmLabel: t('assoc.unsetAction'),
      destructive: true,
      onConfirm: () => {
        void (async () => {
          setBusyId(row.id)
          setStatus(null)
          try {
            await window.vav.settings.unsetFileAssociation(row.id)
            await refresh()
            setStatus({ tone: 'ok', text: t('assoc.unsetSuccess', { label: row.label }) })
          } catch (err) {
            setStatus({
              tone: 'error',
              text: `${t('assoc.setFailed')} ${(err as Error).message}`.trim()
            })
          } finally {
            setBusyId(null)
          }
        })()
      }
    })
  }

  const registerAll = (): void => {
    showDialog({
      title: t('assoc.registerAllTitle'),
      body: PLATFORM === 'win32' ? t('assoc.registerAllBodyWin') : t('assoc.registerAllBody'),
      confirmLabel: t('assoc.registerAll'),
      onConfirm: () => {
        void (async () => {
          setRegistering(true)
          setStatus(null)
          try {
            const result = await window.vav.settings.registerAllFileAssociations()
            await refresh()
            if (result.failed.length === 0) {
              setStatus({
                tone: 'ok',
                text:
                  PLATFORM === 'win32'
                    ? t('assoc.registerAllSuccessWin')
                    : t('assoc.registerAllSuccess', { n: result.updated.length })
              })
            } else {
              setStatus({
                tone: 'error',
                text: `${t('assoc.registerAllPartial')} ${result.failed.map((f) => f.id).join(', ')}`
              })
            }
          } catch (err) {
            setStatus({
              tone: 'error',
              text: `${t('assoc.setFailed')} ${(err as Error).message}`.trim()
            })
          } finally {
            setRegistering(false)
          }
        })()
      }
    })
  }

  return (
    <div className="settings-form assoc-settings" data-testid="settings-assoc">
      <div className="assoc-toolbar">
        <p className="muted tiny">{intro}</p>
        <Button
          label={registering ? t('assoc.registering') : t('assoc.registerAll')}
          variant="ghost"
          size="sm"
          icon={registering ? <Loader2 className="spin" size={12} /> : undefined}
          disabled={registering}
          onClick={registerAll}
        />
      </div>
      {status ? (
        <div
          className={`form-hint${status.tone === 'error' ? ' accounts-error' : ''}`}
          role={status.tone === 'error' ? 'alert' : 'status'}
        >
          {status.text}
        </div>
      ) : null}

      <div className="assoc-list">
        {p0.map((row) => (
          <AssociationRow
            key={row.id}
            row={row}
            busy={busyId === row.id}
            unsetLabel={t('assoc.unset')}
            setLabel={t('assoc.setAsDefault')}
            onSet={() => confirmSet(row)}
            onUnset={() => confirmUnset(row)}
          />
        ))}
      </div>

      {p1.length > 0 && (
        <>
          <div className="assoc-section-title">{t('assoc.p1Heading')}</div>
          <p className="muted tiny">{t('assoc.p1Hint')}</p>
          <div className="assoc-list">
            {p1.map((row) => (
              <AssociationRow
                key={row.id}
                row={row}
                busy={busyId === row.id}
                unsetLabel={t('assoc.unset')}
                setLabel={t('assoc.setAsDefault')}
                onSet={() => confirmSet(row)}
                onUnset={() => confirmUnset(row)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function AssociationRow({
  row,
  busy,
  setLabel,
  unsetLabel,
  onSet,
  onUnset
}: {
  row: FileAssociationStatus
  busy: boolean
  setLabel: string
  unsetLabel: string
  onSet: () => void
  onUnset: () => void
}): React.JSX.Element {
  return (
    <div className="assoc-row">
      <FileText size={16} className="assoc-row-icon" />
      <div className="assoc-row-meta">
        <div className="assoc-row-label" title={row.label}>
          {row.label}
        </div>
        <div className="muted tiny">
          {row.extensions.join(', ')} · {row.uti}
        </div>
      </div>
      <span
        className={`assoc-tag${row.isVav ? ' is-vav' : ''}`}
        title={row.isVav ? 'VAV' : row.defaultApp || unsetLabel}
      >
        {row.isVav ? 'VAV' : row.defaultApp || unsetLabel}
      </span>
      <Button
        label={setLabel}
        variant="secondary"
        size="sm"
        icon={
          busy ? (
            <Loader2 className="spin" size={12} />
          ) : row.isVav ? (
            <Check size={12} />
          ) : (
            <Plus size={12} />
          )
        }
        disabled={busy || row.isVav}
        onClick={row.isVav ? onUnset : onSet}
        title={row.isVav ? unsetLabel : setLabel}
      />
    </div>
  )
}
