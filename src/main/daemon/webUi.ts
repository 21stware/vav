/** Bundled control UI served by `vavd` at `/`. Same phone protocol over `/vav`. */
export const WEB_UI_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>VAV</title>
  <style>
    :root { color-scheme: light dark; --ink:#131b35; --paper:#fbfbfe; --accent:#6b5bc0; --muted:#6b6d7a; }
    html,body { margin:0; height:100%; font:15px/1.45 ui-sans-serif,system-ui,sans-serif; background:var(--paper); color:var(--ink); }
    body { display:grid; grid-template-columns: 240px 1fr; }
    aside { border-right:1px solid color-mix(in srgb, var(--ink) 12%, transparent); padding:16px; display:flex; flex-direction:column; gap:12px; }
    main { display:flex; flex-direction:column; min-width:0; }
    h1 { font-size:16px; margin:0; }
    input,button,textarea { font:inherit; }
    input,textarea { width:100%; box-sizing:border-box; padding:8px 10px; border:0; background:color-mix(in srgb, var(--ink) 6%, transparent); border-radius:8px; }
    button { background:var(--accent); color:#fff; border:0; border-radius:8px; padding:8px 12px; cursor:pointer; }
    button.ghost { background:transparent; color:var(--accent); }
    button:disabled { opacity:0.45; cursor:default; }
    #sessions { list-style:none; margin:0; padding:0; overflow:auto; flex:1; }
    #sessions li { padding:8px; border-radius:8px; cursor:pointer; }
    #sessions li.active { background:color-mix(in srgb, var(--accent) 16%, transparent); }
    #empty { color:var(--muted); font-size:13px; padding:8px; }
    #log { flex:1; overflow:auto; padding:20px 24px; white-space:pre-wrap; }
    .composer { display:flex; gap:8px; padding:12px 16px; }
    .composer textarea { flex:1; min-height:44px; resize:vertical; }
    .controls { display:flex; gap:8px; padding:0 16px 8px; align-items:center; }
    .controls select, .controls input { flex:1; }
    #status { color:var(--muted); font-size:12px; }
    #ask { display:none; gap:8px; padding:0 16px 8px; align-items:center; }
    #ask.open { display:flex; }
    #askPrompt { flex:1; color:var(--muted); font-size:13px; }
    @media (max-width:720px) { body { grid-template-columns:1fr; } aside { border-right:0; border-bottom:1px solid color-mix(in srgb, var(--ink) 12%, transparent); } }
  </style>
</head>
<body>
  <aside>
    <h1>VAV</h1>
    <div id="status">Disconnected</div>
    <input id="secret" placeholder="Pairing secret or vav-daemon://…" autocomplete="off" />
    <button id="connect">Connect</button>
    <button id="create" class="ghost">New session</button>
    <div id="empty">No sessions yet — connect, then New session or send.</div>
    <ul id="sessions"></ul>
  </aside>
  <main>
    <div id="log"></div>
    <div class="controls">
      <input id="model" placeholder="Model id" />
      <select id="approval">
        <option value="auto">Normal</option>
        <option value="bypass">Bypass</option>
        <option value="edit">Read</option>
      </select>
      <button type="button" id="apply" class="ghost">Apply</button>
    </div>
    <div id="ask">
      <div id="askPrompt"></div>
      <input id="askAnswer" placeholder="Reply…" />
      <button type="button" id="askSend">Reply</button>
    </div>
    <form class="composer" id="sendForm">
      <textarea id="text" placeholder="Ask… (Enter to send, Shift+Enter for a new line)" rows="2"></textarea>
      <button type="button" id="cancel" class="ghost" disabled>Cancel</button>
      <button type="submit">Send</button>
    </form>
  </main>
  <script>
    const $ = (id) => document.getElementById(id)
    let ws, sessions = [], active = null, draft = '', pendingText = '', awaiting = null, running = false
    const secretBox = $('secret')
    secretBox.value = localStorage.getItem('vavd-secret') || ''

    function pairingAuthFromInput(raw) {
      const text = String(raw || '').trim()
      if (!text) return ''
      if (text.startsWith('vav-daemon://')) {
        try {
          const url = new URL(text)
          if (url.username) return decodeURIComponent(url.username)
        } catch {}
      }
      const hostPort = text.match(/^\\S+:\\d+\\s*[#\\s]+(\\S+)$/)
      if (hostPort && hostPort[1]) return hostPort[1]
      return text
    }
    function setStatus(text) { $('status').textContent = text }
    function setConnected(on) {
      $('connect').textContent = on ? 'Disconnect' : 'Connect'
      $('cancel').disabled = !on || !running
    }
    function setAsk(card) {
      awaiting = card
      const box = $('ask')
      if (!card) { box.classList.remove('open'); $('askPrompt').textContent = ''; return }
      box.classList.add('open')
      $('askPrompt').textContent = card.prompt || card.title || 'VAV is waiting for a reply'
      $('askAnswer').value = ''
      $('askAnswer').focus()
    }
    function renderSessions() {
      const list = $('sessions')
      list.replaceChildren()
      $('empty').hidden = sessions.length > 0
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
    function appendLog(text) {
      const log = $('log')
      log.textContent += text
      log.scrollTop = log.scrollHeight
    }
    function send(obj) {
      if (ws && ws.readyState === 1) { ws.send(JSON.stringify(obj)); return true }
      setStatus('Not connected')
      return false
    }

    function onMessage(msg) {
      if (msg.type === 'welcome') { setStatus('Connected · '+msg.version); setConnected(true) }
      if (msg.type === 'sessions') { sessions = msg.sessions || []; if (!active && sessions[0]) open(sessions[0].id); renderSessions() }
      if (msg.type === 'created' && msg.session) {
        sessions = [msg.session, ...sessions.filter(s => s.id !== msg.session.id)]
        active = msg.session.id
        renderSessions()
        $('log').textContent = ''
        if (pendingText) {
          const text = pendingText
          pendingText = ''
          actuallySend(text)
        }
      }
      if (msg.type === 'thread') {
        if (msg.conversationId !== active) return
        $('log').textContent = (msg.messages||[]).map((m) => {
          const who = m.role === 'user' ? 'You' : 'VAV'
          const text = (m.blocks||[]).map((b) => b.kind==='text'?b.text:b.kind==='tool'?'['+b.tool+'] ':'').join('') || m.text || ''
          return who+':\\n'+text+'\\n\\n'
        }).join('')
      }
      if (msg.type === 'controls' && msg.conversationId === active) {
        if (msg.model) $('model').value = msg.model
        if (msg.approval) $('approval').value = msg.approval
      }
      if (msg.type === 'turn' && msg.conversationId === active) {
        if (msg.phase === 'start' || msg.draft) { running = true; $('cancel').disabled = false }
        if (msg.draft) { draft = msg.draft; appendLive() }
        if (msg.phase === 'awaiting' && msg.awaiting) {
          running = true
          $('cancel').disabled = false
          appendLog('VAV asks: '+(msg.awaiting.prompt || msg.awaiting.title || '')+'\\n')
          setAsk(msg.awaiting)
        }
        if (msg.phase === 'done' || msg.phase === 'error' || msg.phase === 'cancelled') {
          draft = ''
          running = false
          $('cancel').disabled = true
          setAsk(null)
          send({ type:'thread', conversationId: active })
        }
      }
      if (msg.type === 'error') setStatus(msg.message || msg.code || 'error')
    }
    function appendLive() {
      const log = $('log')
      const frozen = log.dataset.frozen || log.textContent
      log.dataset.frozen = frozen
      log.textContent = frozen + (draft ? 'VAV:\\n'+draft+'\\n' : '')
    }
    function open(id) {
      active = id
      draft = ''
      running = false
      $('cancel').disabled = true
      setAsk(null)
      delete $('log').dataset.frozen
      renderSessions()
      send({ type:'thread', conversationId: id })
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
      if (ws && ws.readyState === 1) { disconnect(); return }
      const secret = pairingAuthFromInput(secretBox.value)
      if (!secret) { setStatus('Paste the pairing secret or vav-daemon:// URI'); return }
      localStorage.setItem('vavd-secret', secretBox.value.trim())
      if (ws) ws.close()
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(proto+'://'+location.host+'/vav')
      ws.onopen = () => {
        setStatus('Authenticating…')
        send({ type:'hello', proto:1, auth: secret, role:'phone', device: 'web' })
      }
      ws.onclose = () => { setConnected(false); setStatus('Disconnected') }
      ws.onerror = () => setStatus('Socket error — is vavd running?')
      ws.onmessage = (ev) => {
        const lines = String(ev.data).split('\\n').filter(Boolean)
        for (const line of lines) {
          try { onMessage(JSON.parse(line)) } catch {}
        }
      }
    }
    function actuallySend(text) {
      running = true
      $('cancel').disabled = false
      appendLog('You:\\n'+text+'\\n\\n')
      send({ type:'send', conversationId: active, text })
    }
    function submitSend() {
      const text = $('text').value.trim()
      if (!text) return
      if (!ws || ws.readyState !== 1) { setStatus('Not connected'); return }
      $('text').value = ''
      if (!active) { pendingText = text; send({ type:'create' }); return }
      actuallySend(text)
    }
    $('connect').onclick = connect
    $('create').onclick = () => { if (!send({ type:'create' })) return }
    $('apply').onclick = () => {
      if (!active) { setStatus('Open a session first'); return }
      send({ type:'configure', conversationId: active, model: $('model').value.trim(), approvalMode: $('approval').value })
    }
    $('cancel').onclick = () => { if (active) send({ type:'cancel', conversationId: active }) }
    $('askSend').onclick = () => {
      const answer = $('askAnswer').value.trim()
      if (!active || !awaiting || !answer) return
      send({ type:'reply', conversationId: active, toolCallId: awaiting.id, answer })
      setAsk(null)
    }
    $('sessions').onclick = (e) => {
      const id = e.target.closest('li')?.dataset.id
      if (id) open(id)
    }
    $('sendForm').onsubmit = (e) => { e.preventDefault(); submitSend() }
    $('text').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitSend() }
    })
    $('askAnswer').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); $('askSend').click() }
    })
    if (secretBox.value) connect()
  </script>
</body>
</html>
`
