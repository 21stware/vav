const $ = (id) => document.getElementById(id)
let ws
let sessions = []
let active = null
let draft = ''
let pendingText = ''
let awaiting = null
let running = false

function pairingAuthFromInput(raw) {
  const text = String(raw || '').trim()
  if (!text) return ''
  if (text.startsWith('vav-daemon://')) {
    try {
      const url = new URL(text)
      if (url.username) return decodeURIComponent(url.username)
    } catch {
      /* fall through */
    }
  }
  const hostPort = text.match(/^\S+:\d+\s*[#\s]+(\S+)$/)
  if (hostPort?.[1]) return hostPort[1]
  return text
}

async function loadSaved() {
  const saved = await chrome.storage.local.get(['vavdHost', 'vavdSecret'])
  if (saved.vavdHost) $('host').value = saved.vavdHost
  if (saved.vavdSecret) $('secret').value = saved.vavdSecret
}

function setStatus(text) {
  $('status').textContent = text
}

function setConnected(on) {
  $('connect').textContent = on ? 'Disconnect' : 'Connect'
  if ($('cancel')) $('cancel').disabled = !on || !running
}

function setAsk(card) {
  awaiting = card
  const box = $('ask')
  if (!box) return
  if (!card) {
    box.hidden = true
    box.style.display = 'none'
    $('askPrompt').textContent = ''
    return
  }
  box.hidden = false
  box.style.display = 'flex'
  $('askPrompt').textContent = card.prompt || card.title || 'VAV is waiting for a reply'
  $('askAnswer').value = ''
}

function renderSessions() {
  const list = $('sessions')
  list.replaceChildren()
  for (const s of sessions) {
    const li = document.createElement('li')
    li.dataset.id = s.id
    if (s.id === active) li.className = 'active'
    li.append(s.title || 'Session')
    if (s.dirLabel) {
      const sub = document.createElement('span')
      sub.style.cssText = 'color:var(--muted);font-size:12px'
      sub.textContent = s.dirLabel
      li.append(document.createElement('br'), sub)
    }
    list.append(li)
  }
}

function send(obj) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(obj))
    return true
  }
  setStatus('Not connected')
  return false
}

function openSession(id) {
  active = id
  draft = ''
  running = false
  setAsk(null)
  if ($('cancel')) $('cancel').disabled = true
  delete $('log').dataset.frozen
  renderSessions()
  send({ type: 'thread', conversationId: id })
}

function actuallySend(text) {
  running = true
  if ($('cancel')) $('cancel').disabled = false
  $('log').textContent += `You:\n${text}\n\n`
  send({ type: 'send', conversationId: active, text })
}

function submitSend() {
  const text = $('text').value.trim()
  if (!text) return
  if (!ws || ws.readyState !== 1) {
    setStatus('Not connected')
    return
  }
  $('text').value = ''
  if (!active) {
    pendingText = text
    send({ type: 'create' })
    return
  }
  actuallySend(text)
}

function onMessage(msg) {
  if (msg.type === 'welcome') {
    setStatus(`Connected · ${msg.version}`)
    setConnected(true)
  }
  if (msg.type === 'sessions') {
    sessions = msg.sessions || []
    if (!active && sessions[0]) openSession(sessions[0].id)
    renderSessions()
  }
  if (msg.type === 'created' && msg.session) {
    sessions = [msg.session, ...sessions.filter((s) => s.id !== msg.session.id)]
    openSession(msg.session.id)
    $('log').textContent = ''
    if (pendingText) {
      const text = pendingText
      pendingText = ''
      actuallySend(text)
    }
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
  if (msg.type === 'controls' && msg.conversationId === active) {
    if (msg.model) $('model').value = msg.model
    if (msg.approval) $('approval').value = msg.approval
  }
  if (msg.type === 'turn' && msg.conversationId === active) {
    if (msg.phase === 'start' || msg.draft) {
      running = true
      if ($('cancel')) $('cancel').disabled = false
    }
    if (msg.draft) {
      draft = msg.draft
      const log = $('log')
      const frozen = log.dataset.frozen || log.textContent
      log.dataset.frozen = frozen
      log.textContent = frozen + (draft ? `VAV:\n${draft}\n` : '')
    }
    if (msg.phase === 'awaiting' && msg.awaiting) {
      running = true
      if ($('cancel')) $('cancel').disabled = false
      $('log').textContent += `VAV asks: ${msg.awaiting.prompt || msg.awaiting.title || ''}\n`
      setAsk(msg.awaiting)
    }
    if (msg.phase === 'done' || msg.phase === 'error' || msg.phase === 'cancelled') {
      draft = ''
      running = false
      if ($('cancel')) $('cancel').disabled = true
      setAsk(null)
      send({ type: 'thread', conversationId: active })
    }
  }
  if (msg.type === 'error') setStatus(msg.message || msg.code || 'error')
}

function disconnect() {
  if (ws) {
    ws.onclose = null
    ws.close()
    ws = null
  }
  running = false
  setAsk(null)
  setConnected(false)
  setStatus('Disconnected')
}

function connect() {
  if (ws && ws.readyState === 1) {
    disconnect()
    return
  }
  const host = $('host').value.trim()
  const secret = pairingAuthFromInput($('secret').value)
  if (!host || !secret) {
    setStatus('Need local vavd URL and pairing secret or vav-daemon:// URI')
    return
  }
  void chrome.storage.local.set({ vavdHost: host, vavdSecret: $('secret').value.trim() })
  if (ws) ws.close()
  ws = new WebSocket(host)
  ws.onopen = () => {
    setStatus('Authenticating…')
    send({ type: 'hello', proto: 1, auth: secret, role: 'phone', device: 'chrome' })
  }
  ws.onclose = () => {
    setConnected(false)
    setStatus('Disconnected')
  }
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
$('apply').onclick = () => {
  if (!active) {
    setStatus('Open a session first')
    return
  }
  send({
    type: 'configure',
    conversationId: active,
    model: $('model').value.trim(),
    approvalMode: $('approval').value
  })
}
if ($('cancel')) {
  $('cancel').onclick = () => {
    if (active) send({ type: 'cancel', conversationId: active })
  }
}
if ($('askSend')) {
  $('askSend').onclick = () => {
    const answer = $('askAnswer').value.trim()
    if (!active || !awaiting || !answer) return
    send({ type: 'reply', conversationId: active, toolCallId: awaiting.id, answer })
    setAsk(null)
  }
}
$('sessions').onclick = (event) => {
  const id = event.target.closest('li')?.dataset.id
  if (id) openSession(id)
}
$('sendForm').onsubmit = (event) => {
  event.preventDefault()
  submitSend()
}
$('text').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    submitSend()
  }
})

void loadSaved().then(() => {
  if ($('secret').value) connect()
})
