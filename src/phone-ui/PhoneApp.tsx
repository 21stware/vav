import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import App from '../renderer/src/App'
import { useSessionStore } from '../renderer/src/state/sessionStore'
import { isAttachablePageUrl } from './pageContext'
import type { PhoneLinkStatus, PhonePageState, PhoneTransport } from './phoneTransport'

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
  const [secret, setSecret] = useState('')
  const [pageHost, setPageHost] = useState<Element | null>(null)

  useEffect(() => transport.onStatus(setLink), [transport])
  useEffect(() => transport.onPage(setPage), [transport])

  useEffect(() => {
    const open = (): void => setPairOpen(true)
    window.addEventListener('vav:phone-open-connect', open)
    return () => window.removeEventListener('vav:phone-open-connect', open)
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
      await send(text)
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
              placeholder="vav-daemon://… or pairing secret"
              autoComplete="off"
            />
            <button type="button" id="connect" className="ghost" onClick={() => transport.connect(secret)}>
              Connect
            </button>
          </>
        ) : null}
        <button type="submit">Send</button>
      </form>

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
              placeholder="vav-daemon://… or http://127.0.0.1:4752"
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
