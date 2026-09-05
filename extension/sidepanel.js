import { renderMarkdown, escapeHtml } from './lib/markdown.js'

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
  const row = session()
  return row?.status === 'running'
}

function toolTone(name) {
  if (/write|edit|replace/.test(name)) return 'var(--tone-write)'
  if (/search|fetch|web/.test(name)) return 'var(--tone-web)'
  if (/term|bash|shell/.test(name)) return 'var(--tone-shell)'
  return 'var(--tone-read)'
}

function toolLabel(tool) {
  const map = {
    terminal: 'Terminal',
    fs_read: 'Read file',
    read_file: 'Read file',
    fs_write: 'Write file',
    write_file: 'Write file',
    fs_list: 'List',
    web_search: 'Search',
    web_fetch: 'Fetch',
    ask_user_question: 'Question',
    request: 'Approval'
  }
  return map[tool] || tool || 'Tool'
}

function renderBlock(block) {
  if (block.kind === 'text' && block.text) {
    return `<div class="md">${renderMarkdown(block.text)}</div>`
  }
  if (block.kind === 'reasoning' && block.text) {
    return `<details class="think" open><summary>Thinking</summary><div>${escapeHtml(block.text)}</div></details>`
  }
  if (block.kind === 'tool') {
    const name = escapeHtml(block.name || toolLabel(block.tool))
    const sum = escapeHtml(block.summary || '')
    return `<div class="tool" data-status="${escapeHtml(block.status || '')}">
      <span class="mark" style="background:${toolTone(block.tool || '')}"></span>
      <span class="name">${name}</span>
      <span class="sum">${sum}</span>
    </div>`
  }
  if (block.kind === 'plan') {
    const steps = (block.steps || [])
      .map((step) => `<li class="${step.done ? 'done' : ''}">${escapeHtml(step.text)}</li>`)
      .join('')
    return `<div class="plan"><h3>${escapeHtml(block.title || 'Plan')}</h3><ul>${steps}</ul></div>`
  }
  if (block.kind === 'awaiting') {
    const choices = (block.choices || [])
      .map(
        (c) =>
          `<button type="button" data-reply="${escapeHtml(block.id)}" data-answer="${escapeHtml(c.id)}">${escapeHtml(c.label)}</button>`
      )
      .join('')
    const fallback =
      choices ||
      `<button type="button" data-reply="${escapeHtml(block.id)}" data-answer="Allow">Allow</button>
       <button type="button" data-reply="${escapeHtml(block.id)}" data-answer="Deny">Deny</button>`
    return `<div class="await">
      <h3>${escapeHtml(block.title || 'Needs a reply')}</h3>
      <p>${escapeHtml(block.prompt || '')}</p>
      <div class="await-actions">${fallback}</div>
    </div>`
  }
  return ''
}

function splitPageContext(text) {
  const idx = text.indexOf('\n\n[Current page]')
  if (idx === -1) return { ask: text, page: '' }
  return { ask: text.slice(0, idx).trim(), page: text.slice(idx).trim() }
}

function turnHtml(role, body) {
  const who = role === 'user' ? 'You' : role === 'system' ? 'System' : 'Agent'
  return `<article class="message-turn ${role}"><div class="message-role">${who}</div><div class="message ${role}">${body}</div></article>`
}

function renderMessage(msg) {
  const raw = msg.text || (msg.blocks || []).filter((b) => b.kind === 'text').map((b) => b.text).join('\n')
  if (msg.role === 'user' && raw.includes('[Current page]')) {
    const { ask, page } = splitPageContext(raw)
    const title = (page.match(/Title: ([^\n]+)/) || [])[1] || 'This page'
    return turnHtml(
      'user',
      `${ask ? `<div class="md">${renderMarkdown(ask)}</div>` : ''}<div class="page-ref">${escapeHtml(title)}</div>`
    )
  }
  const blocks = (msg.blocks || []).map(renderBlock).join('')
  const body = blocks || (raw ? `<div class="md">${renderMarkdown(raw)}</div>` : '')
  return turnHtml(msg.role, body)
}

function renderLive(id) {
  const awaiting = state.awaiting[id]
  const blocks = state.liveBlocks[id] || []
  const thinking = state.thinking[id]
  const draft = state.drafts[id]
  let html = ''
  if (thinking) {
    html += `<details class="think" open><summary>Thinking…</summary><div>${escapeHtml(thinking)}</div></details>`
  }
  if (blocks.length) html += blocks.map(renderBlock).join('')
  else if (draft) html += `<div class="md">${renderMarkdown(draft)}</div>`
  if (awaiting) html += renderBlock(awaiting)
  if (!html) return ''
  return turnHtml('assistant', html)
}

function renderTranscript() {
  const log = $('transcript')
  const id = state.active
  if (!id) {
    log.innerHTML = `<div class="empty"><img class="empty-logo" src="icons/icon48.png" alt="" /><div class="empty-title">Message the agent to start this session.</div></div>`
    return
  }
  const messages = state.threads[id] || []
  const live = isRunning() || state.awaiting[id] || state.drafts[id] || (state.liveBlocks[id] || []).length
  log.innerHTML =
    messages.map(renderMessage).join('') + (live ? renderLive(id) : '') ||
    `<div class="empty"><img class="empty-logo" src="icons/icon48.png" alt="" /><div class="empty-title">Message the agent to start this session.</div></div>`
  log.scrollTop = log.scrollHeight
}

function renderSessions() {
  const pinned = state.sessions.filter((s) => s.pinned)
  const rest = state.sessions.filter((s) => !s.pinned)
  const rows = [...pinned, ...rest]
  $('sessions').innerHTML = rows
    .map((s) => {
      const pin = s.pinned ? '<span class="pin">Pinned</span> ' : ''
      return `<li data-id="${escapeHtml(s.id)}" class="${s.id === state.active ? 'active' : ''}">
        <div class="conv-text">
          <div class="conv-title">${pin}${escapeHtml(s.title || 'New session')}</div>
          <div class="conv-subtitle">${escapeHtml(s.dirLabel || s.preview || 'Workspace')}</div>
        </div>
      </li>`
    })
    .join('')
}

function fillSelect(el, choices, value) {
  const rows = choices && choices.length ? choices : null
  if (!rows) {
    if (value) el.value = value
    return
  }
  el.innerHTML = rows
    .map((c) => `<option value="${escapeHtml(c.id)}"${c.id === value ? ' selected' : ''}>${escapeHtml(c.label || c.id)}</option>`)
    .join('')
  if (value && ![...el.options].some((o) => o.value === value)) {
    const opt = document.createElement('option')
    opt.value = value
    opt.textContent = value
    opt.selected = true
    el.appendChild(opt)
  }
}

function fillList(el, choices, value) {
  if (value) el.value = value
  const list = $('modelList')
  if (!list) return
  const rows = choices && choices.length ? choices : value ? [{ id: value, label: value }] : []
  list.innerHTML = rows.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.label || c.id)}</option>`).join('')
}

function renderControls() {
  const controls = state.controls[state.active]
  if (!controls) return
  fillList($('model'), controls.models, controls.model)
  if (controls.approvals?.length) fillSelect($('approval'), controls.approvals, controls.approval)
  else if (controls.approval) $('approval').value = controls.approval
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
  $('sessionBar').hidden = !row
  if (row) {
    $('title').textContent = row.title || 'Session'
    $('dirLabel').textContent = row.dirLabel || ''
  }
  $('stopBtn').hidden = !isRunning()
  $('pairSheet').hidden = !(state.status === 'error' && !state.sessions.length)
  $('pinBtn').textContent = row?.pinned ? 'Unpin' : 'Pin'
  $('favBtn').textContent = row?.favorite ? 'Unfavorite' : 'Favorite'
}

function render() {
  renderChrome()
  renderSessions()
  renderControls()
  renderPage()
  renderTranscript()
}

function post(msg) {
  port.postMessage(msg)
}

function applyControls() {
  if (!state.active) return
  post({
    type: 'configure',
    patch: {
      model: $('model').value.trim(),
      approvalMode: $('approval').value
    }
  })
}

port.onMessage.addListener((msg) => {
  if (msg.type === 'state') {
    state = msg.state
    render()
  }
})

$('create').onclick = () => {
  $('drawer').hidden = true
  post({ type: 'create' })
}
$('sessionsBtn').onclick = () => {
  $('drawer').hidden = !$('drawer').hidden
}
$('closeDrawer').onclick = () => {
  $('drawer').hidden = true
}
$('sessions').onclick = (event) => {
  const id = event.target.closest('li')?.dataset.id
  if (!id) return
  post({ type: 'open', id })
  $('drawer').hidden = true
}
$('apply').onclick = applyControls
$('model').onchange = applyControls
$('approval').onchange = applyControls
$('stopBtn').onclick = () => post({ type: 'cancel' })
$('includePage').onchange = () => post({ type: 'toggle-page', on: $('includePage').checked })
$('includeShot').onchange = () => post({ type: 'toggle-shot', on: $('includeShot').checked })
$('retry').onclick = () => post({ type: 'rediscover' })
$('connect').onclick = () => post({ type: 'pair', text: $('secret').value })
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
