/** Bundled control UI served by `vavd` at `/`. Same phone protocol over `/vav`. */
export const WEB_UI_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>VAV</title>
  <link rel="icon" type="image/png" href="/icon.png" />
  <style>
    :root {
      color-scheme: light dark;
      --font-ui: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', system-ui, sans-serif;
      --font-code: 'SF Mono', Menlo, monospace;
      --accent: #3a3a42;
      --accent-hover: #2a2a30;
      --accent-fg: #ffffff;
      --accent-text: #2c2c34;
      --success: #2f7a52;
      --tone-read: #35619f;
      --tone-write: #a1621b;
      --tone-shell: #1f7a86;
      --tone-web: #0f766e;
      --bg-window: #ececee;
      --bg-content: #fcfcfc;
      --bg-raised: #ffffff;
      --bg-sunken: #f2f2f4;
      --bg-hover: rgba(20, 20, 28, 0.05);
      --bg-selected: #e2e2e6;
      --text: #141416;
      --text-secondary: #5c5c66;
      --text-tertiary: #8a8a94;
      --border: rgba(20, 20, 28, 0.09);
      --radius-sm: 6px;
      --radius: 10px;
      --radius-lg: 14px;
      --sidebar-width: 232px;
      --row-height: 38px;
      --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
      --dur-press: 120ms;
      --dur-hover: 140ms;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --accent: #c8c8d0;
        --accent-hover: #d8d8e0;
        --accent-fg: #141416;
        --accent-text: #e4e4ea;
        --success: #6ec596;
        --tone-read: #93b4ea;
        --tone-write: #ddaf74;
        --tone-shell: #6fc3ce;
        --tone-web: #5eead4;
        --bg-window: #121213;
        --bg-content: #1b1b1d;
        --bg-raised: #242427;
        --bg-sunken: #161617;
        --bg-hover: rgba(255, 255, 255, 0.055);
        --bg-selected: #2f2f33;
        --text: #efeff1;
        --text-secondary: #a2a2a9;
        --text-tertiary: #73737b;
        --border: rgba(255, 255, 255, 0.07);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      * { transition: none !important; }
    }
    html, body { margin: 0; height: 100%; font: 14px/1.45 var(--font-ui); background: var(--bg-window); color: var(--text); }
    body { display: grid; grid-template-columns: var(--sidebar-width) 1fr; min-height: 100%; }
    aside {
      background: var(--bg-window);
      padding: 14px 6px 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 0;
      box-shadow: inset -1px 0 0 var(--border);
    }
    .brand { display: flex; align-items: center; gap: 8px; padding: 0 8px 2px; }
    .brand-mark {
      width: 22px; height: 22px; border-radius: 6px;
      overflow: hidden; flex: 0 0 auto;
      background: var(--bg-raised);
    }
    .brand-mark img { width: 100%; height: 100%; display: block; object-fit: cover; }
    .brand-mark .mark-dark { display: none; }
    @media (prefers-color-scheme: dark) {
      .brand-mark .mark-light { display: none; }
      .brand-mark .mark-dark { display: block; }
    }
    .brand strong { font-size: 13px; letter-spacing: -0.02em; font-weight: 650; }
    #status { color: var(--text-tertiary); font-size: 11px; padding: 0 8px 4px; }
    input, button, textarea, select { font: inherit; color: inherit; }
    button {
      border: 0; background: transparent; color: var(--text);
      border-radius: var(--radius-sm); padding: 6px 8px; cursor: pointer;
      transition: transform var(--dur-press) var(--ease-out);
    }
    button:active { transform: scale(0.97); }
    button.primary { background: var(--accent); color: var(--accent-fg); }
    button.ghost { color: var(--text-secondary); }
    #create {
      display: flex; align-items: center; gap: 8px;
      text-align: left;
      height: 32px;
      margin: 0 4px;
      padding: 0 8px;
      border-radius: 7px;
      color: var(--text-secondary);
      font-size: 12.5px;
    }
    #create:hover { background: var(--bg-hover); color: var(--text); }
    #create svg { opacity: 0.7; }
    #sessions { list-style: none; margin: 0; padding: 0 4px 10px; overflow: auto; flex: 1; }
    #sessions li {
      display: flex; align-items: center;
      height: var(--row-height);
      padding: 0 8px;
      border-radius: 7px;
      cursor: default;
      user-select: none;
    }
    #sessions li:hover { background: var(--bg-hover); }
    #sessions li.active { background: var(--bg-selected); }
    #sessions .conv-text { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 1px; }
    #sessions .conv-title {
      font-size: 12.5px; font-weight: 450; letter-spacing: -0.005em;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    #sessions li.active .conv-title { font-weight: 500; }
    #sessions .conv-subtitle {
      font-size: 10.5px; font-weight: 400; color: var(--text-tertiary);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .pair { display: flex; flex-direction: column; gap: 6px; padding: 0 8px; }
    .pair input {
      border: 0; background: color-mix(in srgb, var(--text) 5%, var(--bg-content));
      border-radius: 8px; padding: 8px 10px;
    }
    main {
      background: var(--bg-content);
      display: flex; flex-direction: column; min-width: 0;
    }
    .session-bar {
      padding: 12px 28px 8px;
      display: flex; align-items: baseline; gap: 10px;
    }
    .session-bar h2 {
      margin: 0; font-size: 14px; font-weight: 600; letter-spacing: -0.015em;
    }
    .session-bar span { color: var(--text-tertiary); font-size: 12px; }
    #log {
      flex: 1; overflow: auto; padding: 8px 28px 24px;
    }
    .empty {
      min-height: 56vh; display: flex; flex-direction: column;
      align-items: center; justify-content: center; text-align: center;
      gap: 10px; color: var(--text-secondary);
    }
    .empty-logo { width: 72px; height: 72px; border-radius: 16px; overflow: hidden; }
    .empty-logo img { width: 100%; height: 100%; display: block; object-fit: cover; }
    .empty-logo .mark-dark { display: none; }
    @media (prefers-color-scheme: dark) {
      .empty-logo .mark-light { display: none; }
      .empty-logo .mark-dark { display: block; }
    }
    .empty-title { color: var(--text-secondary); font-size: 13px; max-width: 16rem; }
    .message-turn {
      display: flex; flex-direction: column; gap: 4px;
      margin: 0 auto 18px; max-width: 42rem;
    }
    .message-role {
      font-size: 11px; font-weight: 600; letter-spacing: 0.02em;
      color: var(--text-tertiary); user-select: none;
    }
    .message-turn.assistant .message-role { color: var(--accent-text); }
    .message.user {
      color: var(--text); font-weight: 500; font-size: 14px;
      line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere;
    }
    .message.assistant {
      display: flex; flex-direction: column; gap: 10px;
    }
    .message .md p { margin: 0 0 0.7em; }
    .message .md p:last-child { margin-bottom: 0; }
    .message .md pre {
      margin: 8px 0; padding: 10px 12px; background: var(--bg-sunken);
      border-radius: 8px; overflow: auto; font: 12px/1.45 var(--font-code);
    }
    .tool { display: flex; gap: 8px; align-items: baseline; font-size: 13px; padding: 3px 0; }
    .tool .mark {
      width: 7px; height: 7px; border-radius: 50%; background: var(--success);
      flex: 0 0 auto; transform: translateY(-1px);
    }
    .tool .name { font-weight: 600; }
    .tool .sum { color: var(--text-secondary); }
    .think { color: var(--text-secondary); font-size: 13px; margin: 0 0 8px; }
    .think summary { cursor: pointer; font-weight: 600; font-size: 12px; }
    .dock { padding: 8px 16px 14px; }
    .composer {
      display: flex; flex-direction: column; gap: 0;
      max-width: 42rem; margin: 0 auto;
    }
    .composer-box {
      display: flex; flex-direction: column; gap: 6px;
      padding: 8px 8px 7px 12px;
      border-radius: var(--radius-lg);
      background: color-mix(in srgb, var(--text) 4%, var(--bg-content));
      box-shadow: inset 0 0 0 1px var(--border);
    }
    .composer-box:focus-within {
      background: color-mix(in srgb, var(--text) 5.5%, var(--bg-content));
    }
    .composer textarea {
      border: 0; outline: 0; resize: none; background: transparent;
      min-height: 44px; line-height: 1.55; width: 100%; box-sizing: border-box;
    }
    .composer textarea::placeholder { color: var(--text-tertiary); }
    .composer-bar { display: flex; align-items: center; gap: 6px; min-width: 0; }
    .composer-bar .spacer { flex: 1 1 8px; min-width: 4px; }
    .model-picker {
      border: 0; background: transparent; color: var(--text-secondary);
      font-size: 11.5px; max-width: 132px; min-width: 0; height: 22px;
      padding: 0 6px; border-radius: var(--radius-sm);
      transition: background var(--dur-hover) ease, color var(--dur-hover) ease;
    }
    .model-picker:hover { background: var(--bg-hover); color: var(--text); }
    .send-button {
      width: 26px; height: 26px; border-radius: 8px;
      background: var(--accent); color: var(--accent-fg);
      display: grid; place-items: center; padding: 0; flex: 0 0 auto;
      transition: background var(--dur-hover) ease, transform var(--dur-press) var(--ease-out);
    }
    .send-button:hover { background: var(--accent-hover); }
    .send-button:active { transform: scale(0.94); }
    @media (max-width: 720px) {
      body { grid-template-columns: 1fr; }
      aside { box-shadow: none; border-bottom: 1px solid var(--border); max-height: 34vh; }
    }
  </style>
</head>
<body>
  <aside>
    <div class="brand">
      <span class="brand-mark" aria-hidden="true">
        <img class="mark-light" src="/icon-mark.png" alt="" width="22" height="22" />
        <img class="mark-dark" src="/icon-mark-dark.png" alt="" width="22" height="22" />
      </span>
      <strong>VAV</strong>
    </div>
    <div id="status">Looking for this machine…</div>
    <button type="button" id="create">
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      </svg>
      New session
    </button>
    <ul id="sessions"></ul>
    <div class="pair">
      <input id="secret" placeholder="Pairing secret" autocomplete="off" />
      <button type="button" id="connect" class="ghost">Connect</button>
    </div>
  </aside>
  <main>
    <div class="session-bar">
      <h2 id="title">Session</h2>
      <span id="dirLabel"></span>
    </div>
    <div id="log"></div>
    <div class="dock">
      <form class="composer" id="sendForm">
        <div class="composer-box">
          <textarea id="text" placeholder="Message the agent…" rows="2"></textarea>
          <div class="composer-bar">
            <span class="spacer"></span>
            <input id="model" class="model-picker" placeholder="Model" aria-label="Model" />
            <select id="approval" class="model-picker" aria-label="Approval">
              <option value="auto">Normal</option>
              <option value="bypass">Bypass</option>
              <option value="edit">Read</option>
            </select>
            <button type="button" id="apply" hidden>Apply</button>
            <button type="submit" class="send-button" aria-label="Send">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M8 12.5V3.5M8 3.5 3.5 8M8 3.5 12.5 8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
        </div>
      </form>
    </div>
  </main>
  <script>
    const $ = (id) => document.getElementById(id)
    let ws, sessions = [], active = null, draft = '', thinking = '', thread = []
    const secretBox = $('secret')
    secretBox.value = localStorage.getItem('vavd-secret') || ''

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[ch]))
    }
    function renderMarkdown(source) {
      let text = escapeHtml(source || '')
      text = text.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
      text = text.replace(/\\n/g, '<br>')
      return '<p>' + text + '</p>'
    }
    function setStatus(text) { $('status').textContent = text }
    function session() { return sessions.find((s) => s.id === active) || null }
    function emptyHtml() {
      return '<div class="empty"><div class="empty-logo" aria-hidden="true">'
        + '<img class="mark-light" src="/icon-mark.png" alt="" />'
        + '<img class="mark-dark" src="/icon-mark-dark.png" alt="" />'
        + '</div><div class="empty-title">Message the agent to start this session.</div></div>'
    }
    function renderSessions() {
      $('sessions').innerHTML = sessions.map((s) =>
        '<li data-id="'+s.id+'" class="'+(s.id===active?'active':'')+'"><div class="conv-text">'
        + '<div class="conv-title">'+escapeHtml(s.title||'New session')+'</div>'
        + '<div class="conv-subtitle">'+escapeHtml(s.dirLabel||'Workspace')+'</div>'
        + '</div></li>'
      ).join('')
      const row = session()
      $('title').textContent = row ? (row.title || 'New session') : 'Session'
      $('dirLabel').textContent = row ? (row.dirLabel || '') : ''
    }
    function blockHtml(block) {
      if (block.kind === 'text' && block.text) return '<div class="md">'+renderMarkdown(block.text)+'</div>'
      if (block.kind === 'reasoning' && block.text) return '<details class="think" open><summary>Thinking</summary><div>'+escapeHtml(block.text)+'</div></details>'
      if (block.kind === 'tool') {
        return '<div class="tool"><span class="mark"></span><span class="name">'+escapeHtml(block.name || block.tool || 'Tool')+'</span><span class="sum">'+escapeHtml(block.summary || '')+'</span></div>'
      }
      if (block.kind === 'awaiting') {
        return '<div class="tool"><span class="mark"></span><span class="name">'+escapeHtml(block.title || 'Needs a reply')+'</span><span class="sum">'+escapeHtml(block.prompt || '')+'</span></div>'
      }
      return ''
    }
    function turnHtml(role, body) {
      const who = role === 'user' ? 'You' : role === 'system' ? 'System' : 'Agent'
      return '<article class="message-turn '+role+'"><div class="message-role">'+who+'</div><div class="message '+role+'">'+body+'</div></article>'
    }
    function renderThread(messages) {
      thread = messages || []
      if (!thread.length && !draft && !thinking) {
        $('log').innerHTML = emptyHtml()
        return
      }
      $('log').innerHTML = thread.map((m) => {
        const blocks = (m.blocks || []).map(blockHtml).join('')
        const text = blocks || (m.text ? '<div class="md">'+renderMarkdown(m.text)+'</div>' : '')
        return turnHtml(m.role, text)
      }).join('')
      if (draft || thinking) {
        $('log').innerHTML += turnHtml('assistant',
          (thinking ? '<details class="think" open><summary>Thinking…</summary><div>'+escapeHtml(thinking)+'</div></details>' : '')
          + (draft ? '<div class="md">'+renderMarkdown(draft)+'</div>' : ''))
      }
      $('log').scrollTop = $('log').scrollHeight
    }
    function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)) }
    function applyControls() {
      if (!active) return
      send({ type:'configure', conversationId: active, model: $('model').value.trim(), approvalMode: $('approval').value })
    }

    function onMessage(msg) {
      if (msg.type === 'welcome') setStatus('Connected · '+msg.version)
      if (msg.type === 'host' && msg.name) {
        document.querySelector('.brand strong').textContent = msg.name
      }
      if (msg.type === 'sessions') { sessions = msg.sessions || []; if (!active && sessions[0]) open(sessions[0].id); renderSessions() }
      if (msg.type === 'created' && msg.session) { sessions = [msg.session, ...sessions.filter(s => s.id !== msg.session.id)]; active = msg.session.id; renderSessions(); renderThread([]) }
      if (msg.type === 'thread') {
        if (msg.conversationId !== active) return
        draft = ''; thinking = ''
        renderThread(msg.messages || [])
      }
      if (msg.type === 'controls' && msg.conversationId === active) {
        if (msg.model) $('model').value = msg.model
        if (msg.approval) $('approval').value = msg.approval
      }
      if (msg.type === 'turn' && msg.conversationId === active) {
        if (msg.draft) draft = msg.draft
        if (msg.thinking) thinking = msg.thinking
        if (msg.phase === 'awaiting' && msg.awaiting) {
          draft = (draft || '') + '\\n' + (msg.awaiting.prompt || msg.awaiting.title || '')
        }
        if (msg.phase === 'done' || msg.phase === 'error' || msg.phase === 'cancelled') {
          draft = ''; thinking = ''
          send({ type:'thread', conversationId: active })
        } else {
          renderThread(thread)
        }
      }
      if (msg.type === 'error') setStatus(msg.message || msg.code || 'error')
    }
    function open(id) {
      active = id
      draft = ''
      thinking = ''
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
    $('apply').onclick = applyControls
    $('model').addEventListener('change', applyControls)
    $('approval').addEventListener('change', applyControls)
    $('sessions').onclick = (e) => {
      const id = e.target.closest('li')?.dataset.id
      if (id) open(id)
    }
    $('sendForm').onsubmit = (e) => {
      e.preventDefault()
      const text = $('text').value.trim()
      if (!text || !active) return
      send({ type:'send', conversationId: active, text })
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
          if (info && info.secret) {
            secretBox.value = info.secret
            secretBox.hidden = true
            $('connect').hidden = true
          }
        }
      } catch {}
      if (secretBox.value) connect()
    }
    renderThread([])
    void autoConnect()
  </script>
</body>
</html>
`
