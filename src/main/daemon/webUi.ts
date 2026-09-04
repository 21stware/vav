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
    #sessions { list-style:none; margin:0; padding:0; overflow:auto; flex:1; }
    #sessions li { padding:8px; border-radius:8px; cursor:pointer; }
    #sessions li.active { background:color-mix(in srgb, var(--accent) 16%, transparent); }
    #log { flex:1; overflow:auto; padding:20px 24px; white-space:pre-wrap; }
    .composer { display:flex; gap:8px; padding:12px 16px; }
    .composer textarea { flex:1; min-height:44px; resize:vertical; }
    .controls { display:flex; gap:8px; padding:0 16px 8px; align-items:center; }
    .controls select, .controls input { flex:1; }
    #status { color:var(--muted); font-size:12px; }
    @media (max-width:720px) { body { grid-template-columns:1fr; } aside { border-right:0; border-bottom:1px solid color-mix(in srgb, var(--ink) 12%, transparent); } }
  </style>
</head>
<body>
  <aside>
    <h1>VAV</h1>
    <div id="status">Disconnected</div>
    <input id="secret" placeholder="Pairing secret" autocomplete="off" />
    <button id="connect">Connect</button>
    <button id="create" class="ghost">New session</button>
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
    <form class="composer" id="sendForm">
      <textarea id="text" placeholder="Ask…" rows="2"></textarea>
      <button type="submit">Send</button>
    </form>
  </main>
  <script>
    const $ = (id) => document.getElementById(id)
    let ws, sessions = [], active = null, draft = ''
    const secretBox = $('secret')
    secretBox.value = localStorage.getItem('vavd-secret') || ''

    function setStatus(text) { $('status').textContent = text }
    function renderSessions() {
      $('sessions').innerHTML = sessions.map((s) =>
        '<li data-id="'+s.id+'" class="'+(s.id===active?'active':'')+'">'+(s.title||'Session')+'<br><span style="color:var(--muted);font-size:12px">'+(s.dirLabel||'')+'</span></li>'
      ).join('')
    }
    function appendLog(text) {
      const log = $('log')
      log.textContent += text
      log.scrollTop = log.scrollHeight
    }
    function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)) }

    function onMessage(msg) {
      if (msg.type === 'welcome') setStatus('Connected · '+msg.version)
      if (msg.type === 'sessions') { sessions = msg.sessions || []; if (!active && sessions[0]) open(sessions[0].id); renderSessions() }
      if (msg.type === 'created' && msg.session) { sessions = [msg.session, ...sessions.filter(s => s.id !== msg.session.id)]; active = msg.session.id; renderSessions(); $('log').textContent = '' }
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
        if (msg.draft) { draft = msg.draft; appendLive() }
        if (msg.phase === 'awaiting' && msg.awaiting) {
          appendLog('VAV asks: '+(msg.awaiting.prompt || msg.awaiting.title || '')+'\\n')
        }
        if (msg.phase === 'done' || msg.phase === 'error' || msg.phase === 'cancelled') {
          draft = ''
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
      delete $('log').dataset.frozen
      renderSessions()
      send({ type:'thread', conversationId: id })
    }
    function connect() {
      const secret = secretBox.value.trim()
      if (!secret) { setStatus('Paste the pairing secret'); return }
      localStorage.setItem('vavd-secret', secret)
      if (ws) ws.close()
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(proto+'://'+location.host+'/vav')
      ws.onopen = () => {
        setStatus('Authenticating…')
        send({ type:'hello', proto:1, auth: secret, role:'phone', device: 'web' })
      }
      ws.onclose = () => setStatus('Disconnected')
      ws.onerror = () => setStatus('Socket error')
      ws.onmessage = (ev) => {
        const lines = String(ev.data).split('\\n').filter(Boolean)
        for (const line of lines) {
          try { onMessage(JSON.parse(line)) } catch {}
        }
      }
    }
    $('connect').onclick = connect
    $('create').onclick = () => send({ type:'create' })
    $('apply').onclick = () => {
      if (!active) return
      send({ type:'configure', conversationId: active, model: $('model').value.trim(), approvalMode: $('approval').value })
    }
    $('sessions').onclick = (e) => {
      const id = e.target.closest('li')?.dataset.id
      if (id) open(id)
    }
    $('sendForm').onsubmit = (e) => {
      e.preventDefault()
      const text = $('text').value.trim()
      if (!text || !active) return
      appendLog('You:\\n'+text+'\\n\\n')
      send({ type:'send', conversationId: active, text })
      $('text').value = ''
    }
    async function autoConnect() {
      try {
        const res = await fetch('/discover')
        if (res.ok) {
          const info = await res.json()
          if (info && info.secret) {
            secretBox.value = info.secret
            secretBox.hidden = true
          }
        }
      } catch {}
      if (secretBox.value) connect()
    }
    void autoConnect()
  </script>
</body>
</html>
`
