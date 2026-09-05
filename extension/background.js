import { findLocalVavd } from './lib/discover.js'
import { composeSendText, isAttachablePage } from './lib/pageContext.js'

const DEVICE = 'chrome'
const ports = new Set()

const state = {
  status: 'searching',
  error: '',
  hostName: '',
  version: '',
  origin: '',
  wsUrl: '',
  sessions: [],
  active: '',
  threads: {},
  controls: {},
  drafts: {},
  thinking: {},
  liveBlocks: {},
  awaiting: {},
  host: null,
  page: null,
  includePage: true,
  includeShot: false
}

let ws = null
let helloTimer = 0
let reconnectAt = 0

function snapshot() {
  return structuredClone(state)
}

function broadcast(msg) {
  for (const port of ports) {
    try {
      port.postMessage(msg)
    } catch {
      ports.delete(port)
    }
  }
}

function setStatus(status, extra = {}) {
  Object.assign(state, extra, { status })
  broadcast({ type: 'state', state: snapshot() })
  const colors = { connected: '#2f7a52', searching: '#8a8a94', reconnecting: '#8f6a15', error: '#bf3b3b' }
  const text = status === 'connected' ? '' : status === 'searching' ? '…' : '!'
  void chrome.action.setBadgeBackgroundColor({ color: colors[status] || '#8a8a94' })
  void chrome.action.setBadgeText({ text })
}

function send(obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj))
}

function persistHint(found) {
  const url = new URL(found.origin)
  void chrome.storage.local.set({
    vavDiscoverHint: {
      origin: found.origin,
      ports: [Number(url.port) || 4752],
      hosts: [url.hostname],
      secret: found.secret || undefined
    }
  })
}

async function hint() {
  const saved = await chrome.storage.local.get(['vavDiscoverHint', 'vavdSecret'])
  return {
    ...(saved.vavDiscoverHint || {}),
    secret: saved.vavDiscoverHint?.secret || saved.vavdSecret
  }
}

function attachSocket(found) {
  if (ws) {
    ws.onclose = null
    ws.close()
  }
  state.origin = found.origin
  state.wsUrl = found.wsUrl
  state.hostName = found.name || 'VAV'
  persistHint(found)
  ws = new WebSocket(found.wsUrl)
  ws.onopen = () => {
    setStatus('searching', { error: '' })
    send({ type: 'hello', proto: 1, auth: found.secret, role: 'phone', device: DEVICE })
    helloTimer = setTimeout(() => {
      setStatus('error', { error: 'Pairing timed out' })
      ws?.close()
    }, 8_000)
  }
  ws.onerror = () => setStatus('error', { error: 'Could not reach vavd' })
  ws.onclose = () => {
    clearTimeout(helloTimer)
    ws = null
    if (state.status === 'connected' || state.status === 'searching') {
      setStatus('reconnecting', { error: 'Disconnected — retrying' })
      scheduleReconnect(1_200)
    }
  }
  ws.onmessage = (event) => {
    for (const line of String(event.data).split('\n').filter(Boolean)) {
      try {
        onFrame(JSON.parse(line))
      } catch {
        /* ignore a bad line */
      }
    }
  }
}

function onFrame(msg) {
  if (msg.type === 'welcome') {
    clearTimeout(helloTimer)
    setStatus('connected', { version: msg.version || '', error: '' })
    reconnectAt = 0
    return
  }
  if (msg.type === 'host') {
    state.host = msg
    state.hostName = msg.name || state.hostName
    broadcast({ type: 'state', state: snapshot() })
    return
  }
  if (msg.type === 'sessions') {
    state.sessions = msg.sessions || []
    if (!state.active && state.sessions[0]) openSession(state.sessions[0].id)
    broadcast({ type: 'state', state: snapshot() })
    return
  }
  if (msg.type === 'created' && msg.session) {
    state.sessions = [msg.session, ...state.sessions.filter((row) => row.id !== msg.session.id)]
    openSession(msg.session.id)
    if (state.pendingSend) {
      const pending = state.pendingSend
      state.pendingSend = null
      send({
        type: 'send',
        conversationId: msg.session.id,
        text: pending.text,
        ...(pending.images?.length ? { images: pending.images } : {})
      })
    }
    return
  }
  if (msg.type === 'thread' && msg.conversationId) {
    state.threads[msg.conversationId] = msg.messages || []
    if (msg.conversationId === state.active) {
      state.drafts[msg.conversationId] = ''
      state.thinking[msg.conversationId] = ''
      state.liveBlocks[msg.conversationId] = []
    }
    broadcast({ type: 'state', state: snapshot() })
    return
  }
  if (msg.type === 'controls' && msg.conversationId) {
    state.controls[msg.conversationId] = msg
    broadcast({ type: 'state', state: snapshot() })
    return
  }
  if (msg.type === 'turn' && msg.conversationId) {
    if (msg.draft != null) state.drafts[msg.conversationId] = msg.draft
    if (msg.thinking != null) state.thinking[msg.conversationId] = msg.thinking
    if (msg.blocks) state.liveBlocks[msg.conversationId] = msg.blocks
    if (msg.awaiting) state.awaiting[msg.conversationId] = msg.awaiting
    if (msg.phase === 'done' || msg.phase === 'error' || msg.phase === 'cancelled') {
      state.drafts[msg.conversationId] = ''
      state.thinking[msg.conversationId] = ''
      state.liveBlocks[msg.conversationId] = []
      if (msg.phase !== 'awaiting') delete state.awaiting[msg.conversationId]
      send({ type: 'thread', conversationId: msg.conversationId })
    }
    if (msg.phase === 'awaiting' && msg.awaiting) {
      state.awaiting[msg.conversationId] = msg.awaiting
    }
    const row = state.sessions.find((s) => s.id === msg.conversationId)
    if (row) row.status = msg.phase === 'running' || msg.phase === 'awaiting' ? 'running' : 'idle'
    broadcast({ type: 'state', state: snapshot() })
    return
  }
  if (msg.type === 'error') {
    setStatus(state.status === 'connected' ? 'connected' : 'error', {
      error: msg.message || msg.code || 'error'
    })
  }
}

function openSession(id) {
  state.active = id
  send({ type: 'thread', conversationId: id })
  send({ type: 'controls', conversationId: id })
  broadcast({ type: 'state', state: snapshot() })
}

function scheduleReconnect(ms) {
  const wait = Math.max(ms, reconnectAt ? Math.min(reconnectAt * 2, 12_000) : ms)
  reconnectAt = wait
  setTimeout(() => {
    if (state.status === 'connected') return
    void connect()
  }, wait)
}

async function connect() {
  setStatus('searching', { error: '' })
  const saved = await hint()
  const found = await findLocalVavd(saved)
  if (!found) {
    setStatus('error', { error: 'No vavd on this machine. Start it, then retry.' })
    scheduleReconnect(4_000)
    return
  }
  if (!found.secret && !saved.secret) {
    setStatus('error', { error: 'Found vavd, but pairing needs a pasted URI.' })
    state.origin = found.origin
    broadcast({ type: 'state', state: snapshot() })
    return
  }
  attachSocket({ ...found, secret: found.secret || saved.secret })
}

function parsePairing(text) {
  const trimmed = String(text || '').trim()
  if (!trimmed) return null
  if (trimmed.startsWith('vav-daemon://')) {
    try {
      const url = new URL(trimmed)
      const secret = decodeURIComponent(url.username)
      if (secret.length < 16) return null
      return { secret, host: url.hostname.replace(/^\[|\]$/g, '') }
    } catch {
      return null
    }
  }
  if (trimmed.length >= 16 && !/\s/.test(trimmed)) return { secret: trimmed }
  return null
}

async function pairManual(text) {
  const parsed = parsePairing(text)
  if (!parsed) {
    setStatus('error', { error: 'That pairing line is not valid.' })
    return
  }
  await chrome.storage.local.set({
    vavDiscoverHint: { secret: parsed.secret, hosts: parsed.host ? [parsed.host] : undefined }
  })
  await connect()
}

async function tabId() {
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (active && isAttachablePage({ url: active.url })) return active.id
  const tabs = await chrome.tabs.query({ lastFocusedWindow: true })
  const web = tabs.find((tab) => isAttachablePage({ url: tab.url }))
  return web?.id || active?.id
}

async function ensureContent(id) {
  if (!id) return false
  try {
    const ping = await chrome.tabs.sendMessage(id, { type: 'ping' })
    if (ping?.ok) return true
  } catch {
    /* inject */
  }
  try {
    await chrome.scripting.insertCSS({ target: { tabId: id }, files: ['content.css'] })
  } catch {
    /* css is optional */
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: id }, files: ['content.js'] })
    return true
  } catch {
    return false
  }
}

async function extractPage(id) {
  const tab = id || (await tabId())
  if (!tab) return null
  if (await ensureContent(tab)) {
    try {
      return await chrome.tabs.sendMessage(tab, { type: 'extract' })
    } catch {
      /* fall through */
    }
  }
  try {
    const info = await chrome.tabs.get(tab)
    return { url: info.url || '', title: info.title || '', selection: '', excerpt: '', headings: [] }
  } catch {
    return null
  }
}

async function captureShot(id) {
  const tab = id || (await tabId())
  if (!tab) return null
  try {
    const info = await chrome.tabs.get(tab)
    const windowId = info.windowId
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' })
    const data = String(dataUrl).split(',')[1]
    if (!data) return null
    return { name: 'page.png', mime: 'image/png', data }
  } catch {
    return null
  }
}

async function refreshPage() {
  const page = await extractPage()
  if (isAttachablePage(page)) state.page = page
  broadcast({ type: 'state', state: snapshot() })
  return state.page
}

async function sendTurn({ text, usePage, useShot }) {
  const rawPage = usePage === false ? null : state.includePage ? state.page || (await extractPage()) : null
  const page = isAttachablePage(rawPage) ? rawPage : null
  const composed = composeSendText(text || '', usePage === false ? null : page)
  const images = []
  if (useShot || state.includeShot) {
    const shot = await captureShot()
    if (shot) images.push(shot)
  }
  if (!composed && !images.length) return
  const conversationId = state.active
  if (!conversationId) {
    state.pendingSend = { text: composed, images }
    send({ type: 'create' })
    return
  }
  send({
    type: 'send',
    conversationId,
    text: composed,
    ...(images.length ? { images } : {})
  })
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'vav-page',
      title: 'Ask VAV about this page',
      contexts: ['page']
    })
    chrome.contextMenus.create({
      id: 'vav-selection',
      title: 'Ask VAV about “%s”',
      contexts: ['selection']
    })
  })
  void connect()
})

chrome.runtime.onStartup.addListener(() => {
  void connect()
})

chrome.alarms.create('vav-keep', { periodInMinutes: 1 })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'vav-keep') return
  if (!ws || ws.readyState !== 1) void connect()
  else send({ type: 'ping' })
})

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (tab?.id) await chrome.sidePanel.open({ tabId: tab.id }).catch(() => {})
  const page = await extractPage(tab?.id)
  state.page = page
  state.includePage = true
  const ask =
    info.menuItemId === 'vav-selection'
      ? `Help me with this selection.`
      : `Help me with this page.`
  if (!state.active) send({ type: 'create' })
  await sendTurn({ text: ask, usePage: true })
  broadcast({ type: 'state', state: snapshot() })
})

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'sidepanel') return
  ports.add(port)
  port.postMessage({ type: 'state', state: snapshot() })
  if (state.status !== 'connected') void connect()
  void refreshPage()
  port.onDisconnect.addListener(() => ports.delete(port))
  port.onMessage.addListener(async (msg) => {
    if (msg.type === 'rediscover') return void connect()
    if (msg.type === 'pair') return void pairManual(msg.text)
    if (msg.type === 'create') return send({ type: 'create' })
    if (msg.type === 'open') return openSession(msg.id)
    if (msg.type === 'configure') {
      if (!state.active) return
      send({ type: 'configure', conversationId: state.active, ...msg.patch })
      return
    }
    if (msg.type === 'cancel' && state.active) return send({ type: 'cancel', conversationId: state.active })
    if (msg.type === 'reply' && state.active) {
      send({ type: 'reply', conversationId: state.active, toolCallId: msg.toolCallId, answer: msg.answer })
      return
    }
    if (msg.type === 'rename' && state.active) {
      send({ type: 'rename', conversationId: state.active, title: msg.title })
      return
    }
    if (msg.type === 'archive' && state.active) {
      send({ type: 'archive', conversationId: state.active })
      state.active = ''
      broadcast({ type: 'state', state: snapshot() })
      return
    }
    if (msg.type === 'pin' && state.active) {
      send({ type: 'pin', conversationId: state.active, pinned: msg.pinned })
      return
    }
    if (msg.type === 'favorite' && state.active) {
      send({ type: 'favorite', conversationId: state.active, favorite: msg.favorite })
      return
    }
    if (msg.type === 'refresh-page') return void refreshPage()
    if (msg.type === 'toggle-page') {
      state.includePage = msg.on
      broadcast({ type: 'state', state: snapshot() })
      return
    }
    if (msg.type === 'toggle-shot') {
      state.includeShot = msg.on
      broadcast({ type: 'state', state: snapshot() })
      return
    }
    if (msg.type === 'send') return void sendTurn({ text: msg.text, usePage: msg.usePage, useShot: msg.useShot })
    if (msg.type === 'page-op') {
      const id = await tabId()
      if (!id || !(await ensureContent(id))) return
      try {
        await chrome.tabs.sendMessage(id, msg.op)
      } catch {
        /* page may have navigated */
      }
    }
  })
})

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'ask-selection') {
    state.page = msg.page
    state.includePage = true
    void chrome.sidePanel.open({ tabId: sender.tab?.id }).catch(() => {})
    void sendTurn({ text: 'Help me with this selection.', usePage: true })
    sendResponse({ ok: true })
    return true
  }
  if (msg?.type === 'rediscover') {
    void connect()
    sendResponse({ ok: true })
    return true
  }
  if (msg?.type === 'refresh-page') {
    void refreshPage().then((page) => sendResponse({ ok: true, page }))
    return true
  }
})

chrome.tabs.onActivated.addListener(() => {
  void refreshPage()
})
chrome.tabs.onUpdated.addListener((_id, change) => {
  if (change.status === 'complete' || change.title || change.url) void refreshPage()
})

void connect()
