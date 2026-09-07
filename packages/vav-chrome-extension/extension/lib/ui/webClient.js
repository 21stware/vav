/**
 * Bundled vavd page — same phone protocol as the Chrome extension service worker.
 */
import { mountPhoneShell } from './shell.js'
import { emptyHtml, paintTranscript, renderLiveTurn, renderSessionRows } from './render.js'
import { paintRunBar, readRunPatch } from './runBar.js'

const $ = (id) => document.getElementById(id)

mountPhoneShell(document.body, { variant: 'web', markSrc: '/icon-mark.png' })

let ws
let sessions = []
let active = null
let draft = ''
let thinking = ''
let liveBlocks = []
let awaiting = null
let thread = []
const secretBox = $('secret')
if (secretBox) secretBox.value = localStorage.getItem('vavd-secret') || ''

function send(obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj))
}

function session() {
  return sessions.find((s) => s.id === active) || null
}

function setStatus(text, state) {
  $('status').textContent = text
  if (state) $('dot').dataset.state = state
}

function applyControls() {
  if (!active) return
  send({ type: 'configure', conversationId: active, ...readRunPatch(document) })
}

function paint() {
  $('sessions').innerHTML = renderSessionRows(sessions, active)
  const row = session()
  $('title').textContent = row ? row.title || 'New session' : 'Session'
  $('dirLabel').textContent = row ? row.dirLabel || '' : ''
  $('stopBtn').hidden = row?.status !== 'running'
  const liveHtml =
    row?.status === 'running' || draft || thinking || liveBlocks.length || awaiting
      ? renderLiveTurn({
          thinking,
          blocks: liveBlocks,
          draft,
          awaiting,
          outputting: Boolean(draft) && !thinking
        })
      : ''
  paintTranscript($('transcript'), {
    messages: thread,
    liveHtml,
    emptyMark: '/icon-mark.png'
  })
  if (!thread.length && !liveHtml) {
    $('transcript').innerHTML = emptyHtml('/icon-mark.png')
  }
}

function open(id) {
  active = id
  draft = ''
  thinking = ''
  liveBlocks = []
  awaiting = null
  thread = []
  paint()
  send({ type: 'thread', conversationId: id })
  send({ type: 'controls', conversationId: id })
}

function onMessage(msg) {
  if (msg.type === 'welcome') setStatus('Connected · ' + (msg.version || ''), 'connected')
  if (msg.type === 'host' && msg.name) $('hostName').textContent = msg.name
  if (msg.type === 'sessions') {
    sessions = msg.sessions || []
    if (!active && sessions[0]) open(sessions[0].id)
    else paint()
  }
  if (msg.type === 'created' && msg.session) {
    sessions = [msg.session, ...sessions.filter((s) => s.id !== msg.session.id)]
    open(msg.session.id)
  }
  if (msg.type === 'thread') {
    if (msg.conversationId !== active) return
    draft = ''
    thinking = ''
    liveBlocks = []
    awaiting = null
    thread = msg.messages || []
    paint()
  }
  if (msg.type === 'controls' && msg.conversationId === active) {
    paintRunBar(document, msg)
    if (msg.dirLabel) $('dirLabel').textContent = msg.dirLabel
  }
  if (msg.type === 'turn' && msg.conversationId === active) {
    if (msg.draft != null) draft = msg.draft
    if (msg.thinking != null) thinking = msg.thinking
    if (msg.blocks) liveBlocks = msg.blocks
    if (msg.awaiting) awaiting = msg.awaiting
    if (msg.phase === 'done' || msg.phase === 'error' || msg.phase === 'cancelled') {
      draft = ''
      thinking = ''
      liveBlocks = []
      awaiting = null
      send({ type: 'thread', conversationId: active })
    } else {
      paint()
    }
  }
  if (msg.type === 'error') setStatus(msg.message || msg.code || 'error', 'error')
}

function connect() {
  const secret = secretBox?.value.trim()
  if (!secret) {
    setStatus('Paste the pairing secret', 'error')
    return
  }
  localStorage.setItem('vavd-secret', secret)
  if (ws) ws.close()
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  ws = new WebSocket(proto + '://' + location.host + '/vav')
  ws.onopen = () => {
    setStatus('Authenticating…', 'searching')
    send({ type: 'hello', proto: 1, auth: secret, role: 'phone', device: 'web' })
  }
  ws.onclose = () => setStatus('Disconnected', 'error')
  ws.onerror = () => setStatus('Socket error', 'error')
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
$('apply').onclick = applyControls
$('model').addEventListener('change', applyControls)
$('approval').addEventListener('change', applyControls)
$('mode').addEventListener('change', applyControls)
$('thinking').addEventListener('change', applyControls)
$('fastBtn').addEventListener('click', () => {
  const btn = $('fastBtn')
  btn.setAttribute('aria-pressed', btn.getAttribute('aria-pressed') === 'true' ? 'false' : 'true')
  applyControls()
})
$('stopBtn').onclick = () => {
  if (active) send({ type: 'cancel', conversationId: active })
}
$('sessions').onclick = (e) => {
  const id = e.target.closest('li')?.dataset.id
  if (id) open(id)
}
$('moreBtn').onclick = () => {
  $('moreSheet').hidden = false
}
$('closeMore').onclick = () => {
  $('moreSheet').hidden = true
}
$('pinBtn').onclick = () => {
  if (active) send({ type: 'pin', conversationId: active, pinned: !session()?.pinned })
  $('moreSheet').hidden = true
}
$('favBtn').onclick = () => {
  if (active) send({ type: 'favorite', conversationId: active, favorite: !session()?.favorite })
  $('moreSheet').hidden = true
}
$('renameBtn').onclick = () => {
  const title = prompt('Session title', session()?.title || '')
  if (title && active) send({ type: 'rename', conversationId: active, title })
  $('moreSheet').hidden = true
}
$('archiveBtn').onclick = () => {
  if (active) send({ type: 'archive', conversationId: active })
  $('moreSheet').hidden = true
}
$('transcript').onclick = (event) => {
  const btn = event.target.closest('[data-reply]')
  if (!btn || !active) return
  send({ type: 'reply', conversationId: active, toolCallId: btn.dataset.reply, answer: btn.dataset.answer })
}
$('sendForm').onsubmit = (e) => {
  e.preventDefault()
  const text = $('text').value.trim()
  if (!text || !active) return
  send({ type: 'send', conversationId: active, text })
  $('text').value = ''
}
$('text').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    $('sendForm').requestSubmit()
  }
})

async function autoConnect() {
  try {
    const res = await fetch('/discover')
    if (res.ok) {
      const info = await res.json()
      if (info && info.secret && secretBox) {
        secretBox.value = info.secret
        secretBox.hidden = true
        $('connect').hidden = true
      }
    }
  } catch {
    /* offline */
  }
  if (secretBox?.value) connect()
}

paint()
void autoConnect()
