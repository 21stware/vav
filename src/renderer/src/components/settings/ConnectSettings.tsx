import { useEffect, useRef, useState } from 'react'
import type { RemoteControlStatus } from '@shared/remoteControl'
import type { HostDiscoveryPeer } from '@shared/ipc'
import type { MessageKey, TParams } from '@shared/i18n'
import { LOCAL_MACHINE_ID } from '@shared/workspaceHost'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'
import { qrDataUrlWithLogo } from '../../lib/qrWithLogo'
import { Button, InlineAlert, Toggle } from '../ui'

const QR_PX = 152
const COPIED_MS = 1600

/**
 * Settings → Connect and the sidebar Connect popup.
 *
 * Incoming (QR + pairing URI) stacked above outgoing (pair a machine).
 * No card chrome — layout gap is the only separator.
 */
export function ConnectSettings(): React.JSX.Element {
  return (
    <div className="connect-layout">
      <div className="connect-panels">
        <RemoteControlSection />
        <MachinesSection />
      </div>
    </div>
  )
}

function RemoteControlSection(): React.JSX.Element {
  const t = useT()
  const showDialog = useSessionStore((s) => s.showDialog)
  const settings = useSessionStore((s) => s.settings)
  const updateSettings = useSessionStore((s) => s.updateSettings)
  const enabled = settings.remoteControlEnabled === true
  const [status, setStatus] = useState<RemoteControlStatus | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void window.vav.remoteControl.status().then((s) => {
      if (alive) setStatus(s)
    })
    const unsubscribe = window.vav.remoteControl.onChanged((s) => {
      if (alive) setStatus(s)
    })
    return () => {
      alive = false
      unsubscribe()
    }
  }, [enabled])

  useEffect(() => {
    const pairingPayload = status?.pairing
    if (!pairingPayload) {
      setQrDataUrl(null)
      return
    }
    let alive = true
    void qrDataUrlWithLogo(pairingPayload, QR_PX).then(
      (url) => {
        if (alive) setQrDataUrl(url)
      },
      () => {
        if (alive) setQrDataUrl(null)
      }
    )
    return () => {
      alive = false
    }
  }, [status?.pairing])

  const devices = status?.devices ??
    status?.clients.map((client) => ({
      device: client.device,
      connected: true,
      lastSeen: client.since
    })) ??
    []
  const ready = enabled && status?.state === 'ready'

  const confirmReset = (kind: 'secret' | 'identity'): void => {
    const title = kind === 'secret' ? t('remote.regenerateSecret') : t('remote.resetIdentity')
    const body = kind === 'secret' ? t('remote.regenerateSecretHint') : t('remote.resetIdentityHint')
    showDialog({
      title,
      body,
      confirmLabel: t('dialog.resetConfirm'),
      destructive: true,
      onConfirm: () => {
        if (kind === 'secret') void window.vav.remoteControl.regenerateSecret()
        else void window.vav.remoteControl.resetIdentity()
      }
    })
  }

  return (
    <section className="connect-panel" data-testid="connect-panel-incoming">
      <div className="connect-panel-head">
        <div className="connect-panel-title">{t('connect.incoming')}</div>
        <Toggle
          checked={enabled}
          title={t('remote.enabled')}
          testId="settings-remote-enabled"
          onChange={(remoteControlEnabled) => void updateSettings({ remoteControlEnabled })}
        />
      </div>

      <PairingLine />

      {!enabled && <p className="connect-lede">{t('remote.enabledHint')}</p>}

      {enabled && status?.state === 'no-binary' && (
        <InlineAlert kind="warning" title={t('remote.stateError')} message={t('remote.stateNoBinary')} />
      )}
      {enabled && status?.state === 'error' && (
        <InlineAlert kind="warning" title={t('remote.stateError')} message={status.error ?? ''} />
      )}
      {enabled && status?.state === 'starting' && (
        <p className="connect-status">{t('remote.stateStarting')}</p>
      )}

      {ready && (
        <div className="connect-incoming-main">
          {qrDataUrl ? (
            <div className="remote-qr">
              <img src={qrDataUrl} alt={t('remote.pairHint')} width={QR_PX} height={QR_PX} />
            </div>
          ) : null}
          <div className="connect-incoming-meta">
            <div className="connect-status">{t('remote.stateReady')}</div>
            <p className="connect-lede">{t('remote.pairHint')}</p>
            {devices.length > 0 && (
              <div className="remote-devices">
                {devices.map((row, index) => (
                  <span key={`${row.device}-${index}`} className="remote-device">
                    {row.device}
                    {'connected' in row
                      ? ` · ${row.connected ? t('machines.online') : t('machines.offline')}`
                      : ''}
                  </span>
                ))}
              </div>
            )}
            <div className="connect-incoming-actions">
              <Button
                label={t('remote.regenerateSecret')}
                size="sm"
                title={t('remote.regenerateSecretHint')}
                onClick={() => confirmReset('secret')}
              />
              <Button
                label={t('remote.resetIdentity')}
                size="sm"
                title={t('remote.resetIdentityHint')}
                onClick={() => confirmReset('identity')}
              />
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function MachinesSection(): React.JSX.Element {
  const t = useT()
  const hosts = useSessionStore((s) => s.hosts)
  const enabled = useSessionStore((s) => s.settings.remoteControlEnabled === true)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [waitingPeer, setWaitingPeer] = useState<string | null>(null)
  const [discovered, setDiscovered] = useState<HostDiscoveryPeer[]>([])
  const pairGen = useRef(0)
  const waitingPeerRef = useRef<string | null>(null)
  waitingPeerRef.current = waitingPeer

  useEffect(() => {
    let alive = true
    void window.vav.hosts.discovered().then((peers) => {
      if (alive) setDiscovered(peers)
    })
    const offDisc = window.vav.hosts.onDiscovered((peers) => {
      if (alive) setDiscovered(peers)
    })
    return () => {
      alive = false
      offDisc()
    }
  }, [enabled])

  const remotes = hosts.filter((h) => h.id !== LOCAL_MACHINE_ID)
  const known = new Set(remotes.map((h) => h.id))
  const unseen = uniqueDiscoveredPeers(
    discovered.filter((p) => p.machineId !== LOCAL_MACHINE_ID && !known.has(p.machineId))
  )

  const cancelPair = (): void => {
    pairGen.current += 1
    setBusy(false)
    setWaitingPeer(null)
    void window.vav.hosts.cancelPair()
  }

  const pair = async (payload: string): Promise<void> => {
    if (busy && !waitingPeer) {
      cancelPair()
      return
    }
    if (busy) return
    const text = payload.trim()
    if (!text) {
      setError(t('machines.pairNeedLine'))
      return
    }
    const id = ++pairGen.current
    setBusy(true)
    setWaitingPeer(null)
    setError(null)
    const result = await window.vav.hosts.pair(text)
    if (id !== pairGen.current) return
    setBusy(false)
    if (!result.ok) {
      if (/pairing cancelled/i.test(result.error)) return
      setError(pairErrorMessage(result.error, t))
      return
    }
    setDraft('')
  }

  const pairLan = async (peer: HostDiscoveryPeer): Promise<void> => {
    if (waitingPeer === peer.machineId) {
      cancelPair()
      return
    }
    const id = ++pairGen.current
    setBusy(true)
    setWaitingPeer(peer.machineId)
    setError(null)
    const result = await window.vav.hosts.pairLan(peer)
    if (id !== pairGen.current) return
    setBusy(false)
    setWaitingPeer(null)
    if (!result.ok) {
      if (/pairing cancelled/i.test(result.error)) return
      setError(pairErrorMessage(result.error, t))
    }
  }

  return (
    <section className="connect-panel" data-testid="settings-machines">
      <div className="connect-panel-head">
        <div className="connect-panel-title">{t('connect.outgoing')}</div>
      </div>
      <p className="connect-lede">{t('machines.hint')}</p>
      <div className="machines-pair">
        <input
          className="text-field"
          value={draft}
          placeholder={t('machines.pairPlaceholder')}
          spellCheck={false}
          data-testid="settings-machines-pair-input"
          onChange={(event) => {
            setDraft(event.target.value)
            if (error) setError(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void pair(draft)
          }}
        />
        <Button
          label={busy && !waitingPeer ? t('common.cancel') : t('machines.pairAction')}
          size="sm"
          disabled={Boolean(waitingPeer)}
          testId="settings-machines-pair"
          onClick={() => void pair(draft)}
        />
      </div>
      {error && <InlineAlert kind="warning" title={t('machines.pairFailed')} message={error} />}

      {remotes.length > 0 && (
        <div className="connect-paired">
          {remotes.map((host) => (
            <div key={host.id} className="connect-peer" data-testid={`settings-machine-${host.id}`}>
              <div className="connect-peer-text">
                <div className="connect-peer-name">{host.name}</div>
                <div className="connect-peer-sub">
                  {host.online ? t('machines.online') : t('machines.offline')}
                </div>
              </div>
              <Button
                label={t('machines.forget')}
                size="sm"
                testId={`settings-machine-forget-${host.id}`}
                onClick={() => void window.vav.hosts.forget(host.id)}
              />
            </div>
          ))}
        </div>
      )}

      <div className="connect-discovered">
        <div className="connect-peers-caption">{t('machines.discovered')}</div>
        <div className="connect-discovered-list">
          {unseen.length === 0 ? (
            <p className="connect-lede">{t('machines.discoveredEmpty')}</p>
          ) : (
            unseen.map((peer) => (
              <div key={`${peer.machineId}-${peer.address}`} className="connect-peer">
                <div className="connect-peer-text">
                  <div className="connect-peer-name">{peer.name}</div>
                  <div className="connect-peer-sub">
                    {waitingPeer === peer.machineId
                      ? t('machines.lanPairWaiting')
                      : `${peer.address}:${peer.port}`}
                  </div>
                </div>
                <Button
                  label={
                    waitingPeer === peer.machineId ? t('common.cancel') : t('machines.pairAction')
                  }
                  size="sm"
                  disabled={busy && waitingPeer !== peer.machineId}
                  onClick={() => {
                    if (waitingPeerRef.current === peer.machineId) cancelPair()
                    else void pairLan(peer)
                  }}
                />
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  )
}

function PairingLine(): React.JSX.Element | null {
  const t = useT()
  const enabled = useSessionStore((s) => s.settings.remoteControlEnabled === true)
  const [pairing, setPairing] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let alive = true
    const refresh = (): void => {
      void window.vav.hosts.pairing().then((value) => {
        if (alive) setPairing(value)
      })
    }
    refresh()
    const offRemote = window.vav.remoteControl.onChanged(() => refresh())
    const offHosts = window.vav.hosts.onChanged(() => refresh())
    return () => {
      alive = false
      offRemote()
      offHosts()
    }
  }, [enabled])

  if (!pairing) return null

  const copy = (): void => {
    void window.vav.conversations.copyToClipboard(pairing).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), COPIED_MS)
    })
  }

  return (
    <div className="connect-pairing" data-testid="connect-pairing-line">
      <div className="connect-pairing-scroll">
        <pre className="connect-pairing-line">{pairing}</pre>
      </div>
      <Button
        label={copied ? t('common.copied') : t('machines.copyPairing')}
        size="sm"
        onClick={copy}
      />
    </div>
  )
}

function uniqueDiscoveredPeers(peers: HostDiscoveryPeer[]): HostDiscoveryPeer[] {
  const seen = new Set<string>()
  const out: HostDiscoveryPeer[] = []
  for (const peer of peers) {
    if (seen.has(peer.machineId)) continue
    seen.add(peer.machineId)
    out.push(peer)
  }
  return out
}

function pairErrorMessage(
  error: string,
  t: (key: MessageKey, params?: TParams) => string
): string {
  const host =
    error.match(/\bEHOSTUNREACH\s+(\S+)/)?.[1] ??
    error.match(/\bENETUNREACH\s+(\S+)/)?.[1] ??
    error.match(/\bEHOSTDOWN\s+(\S+)/)?.[1] ??
    error.match(/\bETIMEDOUT\s+(\S+)/)?.[1] ??
    error.match(/\bECONNREFUSED\s+(\S+)/)?.[1]
  if (/\b(EHOSTUNREACH|ENETUNREACH|EHOSTDOWN)\b/.test(error)) {
    return t('machines.pairUnreachable', { host: host ?? error })
  }
  if (/\bECONNREFUSED\b/.test(error)) {
    return t('machines.pairRefused', { host: host ?? error })
  }
  if (/\bETIMEDOUT\b/.test(error) || /connect timeout/i.test(error)) {
    return t('machines.pairTimeout', { host: host ?? error })
  }
  if (/pairing declined/i.test(error)) return t('machines.lanPairDeclined')
  if (/pairing confirm timed out/i.test(error)) return t('machines.lanPairTimeout')
  if (/pairing requires a pairing line/i.test(error)) return t('machines.lanPairHeadless')
  if (/pairing busy/i.test(error)) return t('machines.lanPairBusy')
  if (/pairing rejected/i.test(error)) return t('machines.pairAuth')
  if (/no tunnel token/i.test(error)) return t('machines.pairNeedToken')
  if (/unrecognized pairing payload/i.test(error)) return t('machines.pairNeedLine')
  if (/tailcat|invalid tailcat|dial exited|context deadline/i.test(error)) {
    return t('machines.pairTunnel')
  }
  return error
}
