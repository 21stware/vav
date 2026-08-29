import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import type { RemoteControlStatus } from '@shared/remoteControl'
import type { HostDiscoveryPeer } from '@shared/ipc'
import { LOCAL_MACHINE_ID } from '@shared/workspaceHost'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'
import { Button, InlineAlert, Toggle } from '../ui'

/**
 * Settings → 连接 (Connect), split by direction:
 * - 连接到 (outgoing): this Mac pairs with another computer's vavd.
 * - 被连接 (incoming): phones / other computers reach this Mac — tunnel QR,
 *   this machine's pairing line, paired devices.
 * The same panel also fills the small Connect popup window from the sidebar.
 */
export function ConnectSettings(): React.JSX.Element {
  const t = useT()
  return (
    <div className="settings-form connect-panels">
      <section className="connect-panel" data-testid="settings-machines">
        <div className="connect-panel-title">{t('connect.outgoing')}</div>
        <MachinesSection />
      </section>
      <section className="connect-panel" data-testid="connect-panel-incoming">
        <div className="connect-panel-title">{t('connect.incoming')}</div>
        <RemoteControlSection />
      </section>
    </div>
  )
}

/**
 * 被连接: tailcat tunnel pairing + this machine's daemon pairing line.
 * Same channel for the phone companion and a later desktop / vavd client.
 * Foreground-realtime scope — the QR carries token + pairing secret.
 */
function RemoteControlSection(): React.JSX.Element {
  const t = useT()
  const settings = useSessionStore((s) => s.settings)
  const updateSettings = useSessionStore((s) => s.updateSettings)
  const enabled = settings.remoteControlEnabled === true
  const [status, setStatus] = useState<RemoteControlStatus | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [pairing, setPairing] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void window.vav.remoteControl.status().then((s) => {
      if (alive) setStatus(s)
    })
    void window.vav.hosts.pairing().then((value) => {
      if (alive) setPairing(value)
    })
    const unsubscribe = window.vav.remoteControl.onChanged((s) => setStatus(s))
    // The pairing line embeds the tunnel token — refresh once hosts report in.
    const offHosts = window.vav.hosts.onChanged(() => {
      void window.vav.hosts.pairing().then((value) => {
        if (alive) setPairing(value)
      })
    })
    return () => {
      alive = false
      unsubscribe()
      offHosts()
    }
  }, [enabled])

  useEffect(() => {
    const pairingPayload = status?.pairing
    if (!pairingPayload) {
      setQrDataUrl(null)
      return
    }
    let alive = true
    void QRCode.toDataURL(pairingPayload, { margin: 1, width: 220, errorCorrectionLevel: 'M' }).then(
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

  return (
    <>
      <div className="form-row">
        <label>{t('remote.enabled')}</label>
        <div className="control">
          <Toggle
            checked={enabled}
            title={t('remote.enabled')}
            testId="settings-remote-enabled"
            onChange={(remoteControlEnabled) => void updateSettings({ remoteControlEnabled })}
          />
        </div>
      </div>
      <div className="form-hint">{t('remote.enabledHint')}</div>

      {enabled && status?.state === 'no-binary' && (
        <InlineAlert kind="warning" title={t('remote.stateError')} message={t('remote.stateNoBinary')} />
      )}
      {enabled && status?.state === 'error' && (
        <InlineAlert
          kind="warning"
          title={t('remote.stateError')}
          message={status.error ?? ''}
        />
      )}
      {enabled && status?.state === 'starting' && (
        <div className="form-hint">{t('remote.stateStarting')}</div>
      )}

      {enabled && status?.state === 'ready' && (
        <>
          {qrDataUrl && (
            <div className="remote-qr">
              <img src={qrDataUrl} alt={t('remote.pairHint')} width={220} height={220} />
            </div>
          )}
          <div className="form-hint">{t('remote.pairHint')}</div>

          {(status.devices ?? status.clients).length > 0 && (
            <div className="form-row">
              <label>{t('remote.connectedDevices')}</label>
              <div className="control remote-devices">
                {(status.devices ?? status.clients.map((client) => ({
                  device: client.device,
                  connected: true,
                  lastSeen: client.since
                }))).map((row, index) => (
                  <span key={`${row.device}-${index}`} className="remote-device">
                    {row.device}
                    {'connected' in row
                      ? ` · ${row.connected ? t('machines.online') : t('machines.offline')}`
                      : ''}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="form-row">
            <label>{t('remote.regenerateSecret')}</label>
            <div className="control">
              <Button
                label={t('remote.regenerateSecret')}
                size="sm"
                onClick={() => void window.vav.remoteControl.regenerateSecret()}
              />
            </div>
          </div>
          <div className="form-hint">{t('remote.regenerateSecretHint')}</div>

          <div className="form-row">
            <label>{t('remote.resetIdentity')}</label>
            <div className="control">
              <Button
                label={t('remote.resetIdentity')}
                size="sm"
                onClick={() => void window.vav.remoteControl.resetIdentity()}
              />
            </div>
          </div>
          <div className="form-hint">{t('remote.resetIdentityHint')}</div>
        </>
      )}

      {enabled && pairing && (
        <>
          <div className="form-row">
            <label>{t('machines.pairingThis')}</label>
            <div className="control">
              <Button
                label={t('machines.copyPairing')}
                size="sm"
                onClick={() => void window.vav.conversations.copyToClipboard(pairing)}
              />
            </div>
          </div>
          <div className="form-hint machines-pairing">{pairing}</div>
        </>
      )}
    </>
  )
}

/** 连接到: pair another computer's daemon / desktop over LAN or a pairing line. */
function MachinesSection(): React.JSX.Element {
  const t = useT()
  const hosts = useSessionStore((s) => s.hosts)
  const enabled = useSessionStore((s) => s.settings.remoteControlEnabled === true)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [discovered, setDiscovered] = useState<HostDiscoveryPeer[]>([])

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
  const unseen = discovered.filter((p) => !known.has(p.machineId))

  const pair = async (payload: string): Promise<void> => {
    const text = payload.trim()
    if (!text) return
    setBusy(true)
    setError(null)
    const result = await window.vav.hosts.pair(text)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setDraft('')
  }

  return (
    <>
      <div className="form-hint connect-panel-hint">{t('machines.hint')}</div>

      <div className="form-row">
        <label>{t('machines.pairLabel')}</label>
        <div className="control machines-pair">
          <input
            className="text-field"
            value={draft}
            placeholder={t('machines.pairPlaceholder')}
            spellCheck={false}
            data-testid="settings-machines-pair-input"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void pair(draft)
            }}
          />
          <Button
            label={t('machines.pairAction')}
            size="sm"
            disabled={busy || !draft.trim()}
            testId="settings-machines-pair"
            onClick={() => void pair(draft)}
          />
        </div>
      </div>
      {error && <InlineAlert kind="warning" title={t('machines.pairFailed')} message={error} />}

      {remotes.length > 0 && (
        <div className="machines-list">
          {remotes.map((host) => (
            <div key={host.id} className="form-row" data-testid={`settings-machine-${host.id}`}>
              <label>
                {host.name}
                <span className="form-hint">
                  {' '}
                  {host.online ? t('machines.online') : t('machines.offline')}
                </span>
              </label>
              <div className="control">
                <Button
                  label={t('machines.forget')}
                  size="sm"
                  testId={`settings-machine-forget-${host.id}`}
                  onClick={() => void window.vav.hosts.forget(host.id)}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {unseen.length > 0 && (
        <>
          <div className="form-hint">{t('machines.discovered')}</div>
          {unseen.map((peer) => (
            <div key={`${peer.machineId}-${peer.address}`} className="form-row">
              <label>
                {peer.name}
                <span className="form-hint">
                  {' '}
                  {peer.address}:{peer.port}
                </span>
              </label>
              <div className="control">
                <Button
                  label={t('machines.pairAction')}
                  size="sm"
                  disabled={busy || !draft.trim()}
                  onClick={() =>
                    void pair(
                      `${peer.address}:${peer.port} ${draft.trim() || ''}`.trim()
                    )
                  }
                />
              </div>
            </div>
          ))}
        </>
      )}
    </>
  )
}
