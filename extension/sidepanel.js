import { mountPhoneShell } from './lib/ui/shell.js'
import { emptyHtml, paintTranscript, renderLiveTurn, renderSessionRows } from './lib/ui/render.js'
import { paintRunBar, readRunPatch } from './lib/ui/runBar.js'

mountPhoneShell(document.body, { variant: 'extension', markSrc: 'icons/icon32.png' })

const $ = (id) => document.getElementById(id)
const port = chrome.runtime.connect({ name: 'sidepanel' })

let state = {
  status: 'searching',
  error: '',
  hostName: 'VAV',
  sessions: [],
  active: '',
  threads: {},
  controls: {},
  drafts: {},
  thinking: {},
  liveBlocks: {},
  awaiting: {},
  page: null,
  includePage: true,
  includeShot: false
}

function session() {
  return state.sessions.find((row) => row.id === state.active) || null
}

function isRunning() {
  return session()?.status === 'running'
}

function post(msg) {
  port.postMessage(msg)
}

function applyControls() {
  if (!state.active) return
  post({ type: 'configure', patch: readRunPatch(document) })
}

function renderPage() {
  const chip = $('pageChip')
  const page = state.page
  if (!page || !page.url || /^(chrome|edge|about|devtools):/i.test(page.url)) {
    chip.hidden = true
    return
  }
  chip.hidden = false
  $('pageTitle').textContent = page.title || 'This page'
  $('pageUrl').textContent = page.selection?.trim()
    ? `Selection · ${page.selection.trim().slice(0, 72)}`
    : page.url
  $('includePage').checked = state.includePage
  $('includeShot').checked = state.includeShot
}

function renderChrome() {
  $('dot').dataset.state = state.status
  $('hostName').textContent = state.hostName || 'VAV'
  const labels = {
    searching: 'Looking for this machine…',
    reconnecting: 'Reconnecting…',
    connected: state.version ? `Connected · ${state.version}` : 'Connected',
    error: state.error || 'Can’t reach vavd'
  }
  $('status').textContent = labels[state.status] || state.status
  const row = session()
  $('title').textContent = row ? row.title || 'New session' : 'Session'
  $('dirLabel').textContent = row ? row.dirLabel || '' : ''
  $('stopBtn').hidden = !isRunning()
  if ($('pairSheet')) {
    $('pairSheet').hidden = !(state.status === 'error' && !state.sessions.length)
  }
  $('pinBtn').textContent = row?.pinned ? 'Unpin' : 'Pin'
  $('favBtn').textContent = row?.favorite ? 'Unfavorite' : 'Favorite'
}

function render() {
  renderChrome()
  $('sessions').innerHTML = renderSessionRows(state.sessions, state.active)
  const controls = state.controls[state.active]
  if (controls) paintRunBar(document, controls)
  renderPage()
  const id = state.active
  const log = $('transcript')
  if (!id) {
    log.innerHTML = emptyHtml('icons/icon48.png')
    return
  }
  const live =
    isRunning() || state.awaiting[id] || state.drafts[id] || (state.liveBlocks[id] || []).length
  const liveHtml = live
    ? renderLiveTurn({
        thinking: state.thinking[id],
        blocks: state.liveBlocks[id],
        draft: state.drafts[id],
        awaiting: state.awaiting[id],
        outputting: Boolean(state.drafts[id]) && !state.thinking[id]
      })
    : ''
  paintTranscript(log, {
    messages: state.threads[id] || [],
    liveHtml,
    emptyMark: 'icons/icon48.png'
  })
}

port.onMessage.addListener((msg) => {
  if (msg.type === 'state') {
    state = msg.state
    render()
  }
})

function newSession() {
  document.body.classList.remove('sidebar-open')
  post({ type: 'create' })
}
$('create').onclick = newSession
$('sidebarCreate').onclick = newSession
$('sessionsBtn').onclick = () => {
  document.body.classList.toggle('sidebar-open')
}
$('sidebarBackdrop').onclick = () => {
  document.body.classList.remove('sidebar-open')
}
$('closeDrawer').onclick = () => {
  document.body.classList.remove('sidebar-open')
}
$('sessions').onclick = (event) => {
  const id = event.target.closest('li')?.dataset.id
  if (!id) return
  post({ type: 'open', id })
  document.body.classList.remove('sidebar-open')
}
$('apply').onclick = applyControls
$('model').onchange = applyControls
$('approval').onchange = applyControls
$('mode').onchange = applyControls
$('thinking').onchange = applyControls
$('fastBtn').onclick = () => {
  const btn = $('fastBtn')
  btn.setAttribute('aria-pressed', btn.getAttribute('aria-pressed') === 'true' ? 'false' : 'true')
  applyControls()
}
$('stopBtn').onclick = () => post({ type: 'cancel' })
$('includePage').onchange = () => post({ type: 'toggle-page', on: $('includePage').checked })
$('includeShot').onchange = () => post({ type: 'toggle-shot', on: $('includeShot').checked })
if ($('retry')) $('retry').onclick = () => post({ type: 'rediscover' })
if ($('connect')) $('connect').onclick = () => post({ type: 'pair', text: $('secret').value })
$('moreBtn').onclick = () => {
  $('moreSheet').hidden = false
}
$('closeMore').onclick = () => {
  $('moreSheet').hidden = true
}
$('pinBtn').onclick = () => {
  post({ type: 'pin', pinned: !session()?.pinned })
  $('moreSheet').hidden = true
}
$('favBtn').onclick = () => {
  post({ type: 'favorite', favorite: !session()?.favorite })
  $('moreSheet').hidden = true
}
$('renameBtn').onclick = () => {
  const title = prompt('Session title', session()?.title || '')
  if (title) post({ type: 'rename', title })
  $('moreSheet').hidden = true
}
$('archiveBtn').onclick = () => {
  post({ type: 'archive' })
  $('moreSheet').hidden = true
}
$('transcript').onclick = (event) => {
  const btn = event.target.closest('[data-reply]')
  if (!btn) return
  post({ type: 'reply', toolCallId: btn.dataset.reply, answer: btn.dataset.answer })
}
$('sendForm').onsubmit = (event) => {
  event.preventDefault()
  const text = $('text').value
  if (!text.trim() && !state.includePage) return
  post({ type: 'send', text })
  $('text').value = ''
}
$('text').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    $('sendForm').requestSubmit()
  }
})

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') post({ type: 'refresh-page' })
})

render()
