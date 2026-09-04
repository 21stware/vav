const $ = (id) => document.getElementById(id)
let ws
let sessions = []
let active = null
let draft = ''

async function loadSaved() {
  const saved = await chrome.storage.local.get(['vavdHost', 'vavdSecret'])
  if (saved.vavdHost) $('host').value = saved.vavdHost
  if (saved.vavdSecret) $('secret').value = saved.vavdSecret
}

function setStatus(text) {
  $('status').textContent = text
}

function renderSessions() {
  $('sessions').innerHTML = sessions
    .map(
      (s) =>
        `<li data-id="${s.id}" class="${s.id === active ? 'active' : ''}">${s.title || 'Session'}<br><span style="color:var(--muted);font-size:12px">${s.dirLabel || ''}</span></li>`
    )
    .join('')
}

function send(obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj))
}

function openSession(id) {
  active = id
  draft = ''
  delete $('log').dataset.frozen
  renderSessions()
  send({ type: 'thread', conversationId: id })
}

function onMessage(msg) {
  if (msg.type === 'welcome') setStatus(`Connected · ${msg.version}`)
  if (msg.type === 'sessions') {
    sessions = msg.sessions || []
    if (!active && sessions[0]) openSession(sessions[0].id)
    renderSessions()
  }
  if (msg.type === 'created' && msg.session) {
    sessions = [msg.session, ...sessions.filter((s) => s.id !== msg.session.id)]
    openSession(msg.session.id)
    $('log').textContent = ''
  }
  if (msg.type === 'thread' && msg.conversationId === active) {
    $('log').textContent = (msg.messages || [])
      .map((m) => {
        const who = m.role === 'user' ? 'You' : 'VAV'
        const text =
          (m.blocks || [])
            .map((b) => (b.kind === 'text' ? b.text : b.kind === 'tool' ? `[${b.tool}] ` : ''))
            .join('') ||
          m.text ||
          ''
        return `${who}:\n${text}\n\n`
      })
      .join('')
  }
  if (msg.type === 'turn' && msg.conversationId === active) {
    if (msg.draft) {
      draft = msg.draft
      const log = $('log')
      const frozen = log.dataset.frozen || log.textContent
      log.dataset.frozen = frozen
      log.textContent = frozen + (draft ? `VAV:\n${draft}\n` : '')
    }
    if (msg.phase === 'done' || msg.phase === 'error' || msg.phase === 'cancelled') {
      draft = ''
      send({ type: 'thread', conversationId: active })
    }
  }
  if (msg.type === 'error') setStatus(msg.message || msg.code || 'error')
}

function connect() {
  const host = $('host').value.trim()
  const secret = $('secret').value.trim()
  if (!host || !secret) {
    setStatus('Need local vavd URL and pairing secret')
    return
  }
  void chrome.storage.local.set({ vavdHost: host, vavdSecret: secret })
  if (ws) ws.close()
  ws = new WebSocket(host)
  ws.onopen = () => {
    setStatus('Authenticating…')
    send({ type: 'hello', proto: 1, auth: secret, role: 'phone', device: 'chrome' })
  }
  ws.onclose = () => setStatus('Disconnected')
  ws.onerror = () => setStatus('Socket error — is vavd running?')
  ws.onmessage = (ev) => {
    for (const line of String(ev.data).split('\n').filter(Boolean)) {
      try {
        onMessage(JSON.parse(line))
      } catch {
        /* ignore */
      }
    }
  }
}

$('connect').onclick = connect
$('create').onclick = () => send({ type: 'create' })
$('sessions').onclick = (event) => {
  const id = event.target.closest('li')?.dataset.id
  if (id) openSession(id)
}
$('sendForm').onsubmit = (event) => {
  event.preventDefault()
  const text = $('text').value.trim()
  if (!text || !active) return
  $('log').textContent += `You:\n${text}\n\n`
  send({ type: 'send', conversationId: active, text })
  $('text').value = ''
}

void loadSaved().then(() => {
  if ($('secret').value) connect()
})
