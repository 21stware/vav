/**
 * Desktop app-shell markup shared by the bundled web page and the Chrome side panel.
 */
const SEND_ICON = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 12.5V3.5M8 3.5 3.5 8M8 3.5 12.5 8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`

const PLUS_ICON = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`

const LIST_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 4.5h10M3 8h10M3 11.5h7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`

export function phoneShellHtml(opts = {}) {
  const variant = opts.variant || 'web'
  const mark = opts.markSrc || (variant === 'web' ? '/icon-mark.png' : 'icons/icon32.png')
  const pairInline = variant === 'web'
  return `
<button type="button" class="sidebar-backdrop" id="sidebarBackdrop" tabindex="-1" aria-hidden="true"></button>
<aside class="sidebar" id="sidebar">
  <div class="sidebar-head">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true"><img src="${mark}" alt="" width="20" height="20" /></span>
      <strong id="hostName">VAV</strong>
    </div>
    ${
      variant === 'extension'
        ? `<button type="button" id="closeDrawer" class="ghost">Done</button>`
        : ''
    }
  </div>
  ${
    variant === 'web'
      ? `<button type="button" id="create" data-testid="new-session">${PLUS_ICON} New session</button>`
      : `<button type="button" id="sidebarCreate" class="ghost">${PLUS_ICON} New session</button>`
  }
  <ul id="sessions" data-testid="sessions"></ul>
  <div class="sidebar-foot">
    <div class="sidebar-connect" data-testid="sidebar-connect">
      <span id="dot" class="dot" data-state="searching" aria-hidden="true"></span>
      <span id="status">Looking for this machine…</span>
    </div>
    ${
      pairInline
        ? `<div class="pair">
      <input id="secret" placeholder="vav-daemon://… or pairing secret" autocomplete="off" />
      <button type="button" id="connect" class="ghost">Connect</button>
    </div>`
        : ''
    }
  </div>
</aside>
<main class="detail">
  <header class="session-chrome">
    ${
      variant === 'extension'
        ? `<button type="button" id="sessionsBtn" class="icon-btn" title="Sessions" aria-label="Sessions">${LIST_ICON}</button>
    <button type="button" id="create" class="icon-btn" data-testid="new-session" title="New session" aria-label="New session">${PLUS_ICON}</button>`
        : ''
    }
    <div class="session-titles" id="sessionBar">
      <h1 id="title">Session</h1>
      <p id="dirLabel"></p>
    </div>
    <button type="button" id="moreBtn" class="icon-btn" title="Session" aria-label="Session actions">⋯</button>
  </header>
  <div id="transcript" class="transcript" data-testid="transcript"></div>
  <div class="dock">
    <section id="pageChip" class="page-chip" hidden>
      <div class="page-chip-copy">
        <strong id="pageTitle">This page</strong>
        <span id="pageUrl"></span>
      </div>
      <label class="toggle"><input type="checkbox" id="includePage" checked /><span>Include</span></label>
      <label class="toggle"><input type="checkbox" id="includeShot" /><span>Shot</span></label>
    </section>
    <form id="sendForm" class="composer" data-testid="composer">
      <div class="composer-box">
        <textarea id="text" data-testid="composer-input" placeholder="Message the agent…" rows="2"></textarea>
        <div class="composer-bar">
          <span class="spacer"></span>
          <div class="session-run-controls" data-testid="session-run-controls">
            <select id="mode" class="session-run-btn" aria-label="Mode" hidden></select>
            <select id="approval" class="session-run-btn model-picker" aria-label="Approval">
              <option value="auto">Normal</option>
              <option value="bypass">Bypass</option>
              <option value="edit">Read</option>
            </select>
            <input id="model" class="model-picker" list="modelList" aria-label="Model" placeholder="Model" />
            <datalist id="modelList"></datalist>
            <select id="thinking" class="session-run-btn" aria-label="Thinking" hidden></select>
            <button type="button" id="fastBtn" class="session-run-btn" hidden aria-pressed="false">Fast</button>
          </div>
          <button type="button" id="apply" hidden>Apply</button>
          <button type="button" id="stopBtn" class="stop-button" hidden title="Stop" aria-label="Stop"><span class="stop-sq"></span></button>
          <button type="submit" class="send-button" data-testid="composer-send" aria-label="Send">${SEND_ICON}</button>
        </div>
      </div>
    </form>
  </div>
</main>
${
  variant === 'extension'
    ? `<div id="pairSheet" class="sheet" hidden>
  <div class="sheet-card">
    <h2>Connect to VAV</h2>
    <p>Open the VAV desktop app on this machine. This panel finds it automatically. Or paste a Connect line / local URL.</p>
    <input id="secret" placeholder="vav-daemon://… or http://127.0.0.1:4752" autocomplete="off" />
    <div class="sheet-actions">
      <button type="button" id="retry">Look again</button>
      <button type="button" id="connect" class="ghost">Pair</button>
    </div>
  </div>
</div>`
    : ''
}
<div id="moreSheet" class="sheet" hidden>
  <div class="sheet-card">
    <button type="button" id="pinBtn">Pin</button>
    <button type="button" id="favBtn">Favorite</button>
    <button type="button" id="renameBtn">Rename</button>
    <button type="button" id="archiveBtn" class="danger">Archive</button>
    <button type="button" id="closeMore" class="ghost">Cancel</button>
  </div>
</div>`
}

export function mountPhoneShell(root, opts = {}) {
  const variant = opts.variant || 'web'
  root.classList.add('app-shell', `is-${variant}`)
  root.innerHTML = phoneShellHtml({ ...opts, variant })
  return root
}
