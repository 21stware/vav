import { lazy, Suspense, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import App from '@/App'
import { useSessionStore } from '@/state/sessionStore'
import { useWorkspaceStore } from '@/state/workspaceStore'
import { LOCAL_MACHINE_ID } from '@shared/workspaceHost'
import { isAttachablePageUrl } from './pageContext'
import type { PhoneLinkStatus, PhonePageState, PhoneTransport } from './phoneTransport'

const SettingsWindow = lazy(() => import('@/SettingsWindow'))

/**
 * Web / extension / remote are the desktop session shell. Pairing, the
 * current-tab chip, and the e2e contract fields are the only extra chrome.
 */
export function PhoneApp({ transport }: { transport: PhoneTransport }): React.JSX.Element {
  return (
    <>
      <App />
      <PhoneChrome transport={transport} />
    </>
  )
}

function PhoneChrome({ transport }: { transport: PhoneTransport }): React.JSX.Element {
  const conversations = useSessionStore((s) => s.conversations)
  const createConversation = useSessionStore((s) => s.createConversation)
  const setModel = useSessionStore((s) => s.setModel)
  const setApprovalMode = useSessionStore((s) => s.setApprovalMode)
  const send = useSessionStore((s) => s.send)
  const [link, setLink] = useState<PhoneLinkStatus>({
    status: 'searching',
    error: '',
    hostName: 'VAV',
    version: ''
  })
  const [page, setPage] = useState<PhonePageState>(transport.pageState())
  const [pairOpen, setPairOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [secret, setSecret] = useState('')
  const [pageHost, setPageHost] = useState<Element | null>(null)

  useEffect(() => transport.onStatus(setLink), [transport])
  useEffect(() => transport.onPage(setPage), [transport])

  useEffect(() => {
    const open = (): void => {
      useSessionStore.getState().openSettings('connect')
      setSettingsOpen(true)
    }
    window.addEventListener('vav:phone-open-connect', open)
    return () => window.removeEventListener('vav:phone-open-connect', open)
  }, [])

  useEffect(() => {
    const open = (): void => setSettingsOpen(true)
    const close = (): void => setSettingsOpen(false)
    window.addEventListener('vav:phone-open-settings', open)
    window.addEventListener('vav:phone-close-settings', close)
    return () => {
      window.removeEventListener('vav:phone-open-settings', open)
      window.removeEventListener('vav:phone-close-settings', close)
    }
  }, [])

  useEffect(() => {
    const open = (event: Event): void => {
      const detail = (event as CustomEvent<{ conversationId?: string; purpose?: 'workdir' | 'locate' | 'directory' }>)
        .detail
      useSessionStore
        .getState()
        .openRemoteFolderPicker(detail?.conversationId || '', LOCAL_MACHINE_ID, detail?.purpose ?? 'workdir')
    }
    window.addEventListener('vav:phone-pick-folder', open)
    return () => window.removeEventListener('vav:phone-pick-folder', open)
  }, [])

  useEffect(() => {
    const open = (event: Event): void => {
      const path = String((event as CustomEvent<{ path?: string }>).detail?.path ?? '').trim()
      if (!path) return
      void (async () => {
        const state = useSessionStore.getState()
        let id = state.activeId
        if (!id) {
          const listed = state.conversations.find(
            (row) => !row.archived && !row.fileId && row.sessionKind !== 'timer'
          )
          if (listed) {
            await state.selectConversation(listed.id)
            id = useSessionStore.getState().activeId || listed.id
          }
        }
        if (id) {
          useWorkspaceStore.getState().selectPath(id, path)
          void state.attachContextFile(id, path)
        }
        useSessionStore.getState().setSessionPreview({ kind: 'file' })
        useSessionStore.getState().setFilePreviewOpen(true)
      })()
    }
    window.addEventListener('vav:phone-open-file-preview', open)
    return () => window.removeEventListener('vav:phone-open-file-preview', open)
  }, [])

  useEffect(() => {
    if (transport.variant !== 'extension') return
    if (link.status === 'error') setPairOpen(true)
    if (link.status === 'connected') setPairOpen(false)
  }, [link.status, transport.variant])

  const showPage = transport.variant === 'extension' && isAttachablePageUrl(page.url)

  useEffect(() => {
    if (!showPage) {
      setPageHost(null)
      return
    }
    const find = (): void => {
      setPageHost(document.querySelector('.detail-stream') ?? document.querySelector('.preview-edit-stream'))
    }
    find()
    const timer = window.setInterval(find, 250)
    return () => window.clearInterval(timer)
  }, [showPage, conversations])

  const pageChip = (
    <section id="pageChip" className="page-chip">
      <div className="page-chip-copy">
        <strong id="pageTitle">{page.title || 'This page'}</strong>
        <span id="pageUrl">
          {page.selection.trim()
            ? `Selection · ${page.selection.trim().slice(0, 72)}`
            : page.url}
        </span>
      </div>
      <label className="toggle">
        <input
          type="checkbox"
          id="includePage"
          checked={page.includePage}
          onChange={(event) => transport.setIncludePage(event.target.checked)}
        />
        <span>Include</span>
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          id="includeShot"
          checked={page.includeShot}
          onChange={(event) => transport.setIncludeShot(event.target.checked)}
        />
        <span>Shot</span>
      </label>
    </section>
  )

  const onContractSubmit = (event: React.FormEvent): void => {
    event.preventDefault()
    const text = (document.getElementById('text') as HTMLTextAreaElement | null)?.value ?? ''
    const model = (document.getElementById('model') as HTMLInputElement | null)?.value.trim() ?? ''
    const approval = (document.getElementById('approval') as HTMLSelectElement | null)?.value ?? ''
    if (!text.trim() && !(page.includePage && isAttachablePageUrl(page.url))) return
    void (async () => {
      let id = useSessionStore.getState().activeId
      if (!id) {
        await createConversation({ openIn: 'here' })
        id = useSessionStore.getState().activeId
      }
      if (id) {
        if (model) await setModel(id, model)
        if (approval === 'auto' || approval === 'bypass' || approval === 'edit') {
          await setApprovalMode(id, approval)
        }
      }
      await send(text, [])
    })()
  }

  return (
    <>
      <div className="phone-link-chip" data-state={link.status}>
        <span id="hostName">{link.hostName || 'VAV'}</span>
        <span id="status">
          {link.status === 'connected'
            ? link.version
              ? `Connected · ${link.version}`
              : 'Connected'
            : link.status === 'error'
              ? link.error || 'Can’t reach vavd'
              : link.status === 'reconnecting'
                ? 'Reconnecting…'
                : 'Looking for this machine…'}
        </span>
      </div>

      {showPage
        ? pageHost
          ? createPortal(pageChip, pageHost)
          : pageChip
        : (
          <section id="pageChip" className="page-chip" hidden />
        )}

      <form id="sendForm" className="phone-e2e-contract" onSubmit={onContractSubmit}>
        <ul id="e2eSessions" hidden>
          {conversations.map((conversation) => (
            <li key={conversation.id} data-id={conversation.id}>
              {conversation.title}
            </li>
          ))}
        </ul>
        <input id="model" name="model" autoComplete="off" />
        <select id="approval" name="approval" defaultValue="auto">
          <option value="auto">Normal</option>
          <option value="bypass">Bypass</option>
          <option value="edit">Read</option>
        </select>
        <button type="button" id="apply" hidden>
          Apply
        </button>
        {transport.variant === 'web' ? (
          <>
            <input
              id="secret"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              placeholder="vavrtp://… or pairing secret"
              autoComplete="off"
            />
            <button type="button" id="connect" className="ghost" onClick={() => transport.connect(secret)}>
              Connect
            </button>
          </>
        ) : null}
        <button type="submit">Send</button>
      </form>

      {settingsOpen ? (
        <div id="settingsSheet" className="sheet" data-testid="phone-settings">
          <div className="sheet-card phone-settings-card">
            <div className="sheet-actions">
              <button type="button" onClick={() => setSettingsOpen(false)}>
                Close
              </button>
            </div>
            <Suspense fallback={<p>Settings…</p>}>
              <SettingsWindow />
            </Suspense>
          </div>
        </div>
      ) : null}

      {pairOpen ? (
        <div id="pairSheet" className="sheet">
          <div className="sheet-card">
            <h2>Connect to VAV</h2>
            <p>
              {transport.variant === 'extension'
                ? 'Open the VAV desktop app on this machine. This panel finds it automatically. Or paste a Connect line / local URL.'
                : 'This page talks to the vavd on this machine. Paste a Connect line if it did not pair automatically.'}
            </p>
            <input
              id="secret"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              placeholder="vavrtp://… or http://127.0.0.1:4752"
              autoComplete="off"
            />
            <div className="sheet-actions">
              <button type="button" id="retry" onClick={() => transport.rediscover()}>
                Look again
              </button>
              <button
                type="button"
                id="connect"
                className="ghost"
                onClick={() => {
                  transport.connect(secret)
                  setPairOpen(false)
                }}
              >
                Pair
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div id="pairSheet" className="sheet" hidden />
      )}
    </>
  )
}
