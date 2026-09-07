/**
 * Transcript + session list — same agent-log semantics as desktop
 * `Transcript` / `MessageRow` / `ToolCard`.
 */
import { escapeHtml, renderMarkdown } from './markdown.js'

export const ROLE = { user: 'You', system: 'System', assistant: 'Agent' }

const TOOL_LABEL = {
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

export function toolLabel(tool) {
  return TOOL_LABEL[tool] || tool || 'Tool'
}

export function turnHtml(role, body) {
  const who = ROLE[role] || (role === 'user' ? 'You' : role === 'system' ? 'System' : 'Agent')
  return `<article class="message-turn ${role}" data-testid="${
    role === 'user' ? 'message-user' : role === 'assistant' ? 'message-assistant' : 'message-system'
  }"><div class="message-role">${who}</div><div class="message ${role}">${body}</div></article>`
}

export function emptyHtml(markSrc) {
  const src = markSrc || 'icons/icon48.png'
  return `<div class="empty-state empty-state-session" data-testid="empty-state"><div class="empty-logo" aria-hidden="true"><img src="${escapeHtml(
    src
  )}" alt="" /></div><div class="empty-title">Message the agent to start this session.</div></div>`
}

function splitPageContext(text) {
  const idx = text.indexOf('\n\n[Current page]')
  if (idx === -1) return { ask: text, page: '' }
  return { ask: text.slice(0, idx).trim(), page: text.slice(idx).trim() }
}

export function renderBlock(block) {
  if (!block) return ''
  if (block.kind === 'text' && block.text) {
    return `<div class="md">${renderMarkdown(block.text)}</div>`
  }
  if (block.kind === 'reasoning' && block.text) {
    return `<details class="thinking-process" data-testid="thinking-process" open><summary>Thinking process</summary><div>${escapeHtml(block.text)}</div></details>`
  }
  if (block.kind === 'tool') {
    const tool = block.tool || block.name || ''
    return `<div class="tool-call" data-testid="tool-card" data-tool="${escapeHtml(tool)}" data-status="${escapeHtml(block.status || '')}">
      <div class="tool-row">
        <span class="tool-glyph" aria-hidden="true"></span>
        <span class="tool-name">${escapeHtml(block.name || toolLabel(tool))}</span>
        <span class="tool-summary">${escapeHtml(block.summary || '')}</span>
      </div>
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
    return `<div class="await" data-testid="approval-card">
      <h3>${escapeHtml(block.title || 'Needs a reply')}</h3>
      <p>${escapeHtml(block.prompt || '')}</p>
      <div class="await-actions">${fallback}</div>
    </div>`
  }
  return ''
}

export function renderMessage(msg) {
  const raw =
    msg.text ||
    (msg.blocks || [])
      .filter((b) => b.kind === 'text')
      .map((b) => b.text)
      .join('\n')
  if (msg.role === 'user' && raw && raw.includes('[Current page]')) {
    const { ask, page } = splitPageContext(raw)
    const title = (page.match(/Title: ([^\n]+)/) || [])[1] || 'This page'
    return turnHtml(
      'user',
      `${ask ? `<div class="md">${renderMarkdown(ask)}</div>` : ''}<div class="page-ref">${escapeHtml(title)}</div>`
    )
  }
  const process = (msg.blocks || []).filter((b) => b.kind === 'reasoning' || b.kind === 'tool')
  const rest = (msg.blocks || []).filter((b) => b.kind !== 'reasoning' && b.kind !== 'tool')
  let body = ''
  if (process.length && msg.role === 'assistant') {
    body += `<details class="thinking-process" data-testid="thinking-process"><summary>Thinking process</summary>${process.map(renderBlock).join('')}</details>`
    body += rest.map(renderBlock).join('')
  } else {
    body += (msg.blocks || []).map(renderBlock).join('')
  }
  if (!body && raw) body = `<div class="md">${renderMarkdown(raw)}</div>`
  return turnHtml(msg.role, body)
}

export function renderLiveTurn({ thinking, blocks, draft, awaiting, outputting }) {
  const process = []
  if (thinking) {
    process.push(
      `<details class="thinking-process" data-testid="thinking-process" open><summary>Thinking process</summary><div>${escapeHtml(thinking)}</div></details>`
    )
  }
  const live = (blocks || []).map(renderBlock).join('')
  const text = !live && draft ? `<div class="md">${renderMarkdown(draft)}</div>` : live
  const wait = awaiting ? renderBlock(awaiting) : ''
  const status = outputting
    ? `<div class="stream-status" data-testid="stream-status">Outputting…</div>`
    : ''
  const html = process.join('') + text + wait + status
  if (!html) return ''
  return turnHtml('assistant', html)
}

export function renderSessionRows(sessions, activeId) {
  const pinned = sessions.filter((s) => s.pinned)
  const rest = sessions.filter((s) => !s.pinned)
  return [...pinned, ...rest]
    .map((s) => {
      const pin = s.pinned ? '<span class="pin">Pinned</span> ' : ''
      const running = s.status === 'running' ? ' · Running' : ''
      return `<li data-id="${escapeHtml(s.id)}" data-testid="session-row" data-conversation-id="${escapeHtml(s.id)}" class="session-row${s.id === activeId ? ' active' : ''}">
        <div class="conv-text">
          <div class="conv-title">${pin}${escapeHtml(s.title || 'New session')}</div>
          <div class="conv-subtitle">${escapeHtml(s.dirLabel || s.preview || 'Workspace')}${running}</div>
        </div>
      </li>`
    })
    .join('')
}

export function paintTranscript(el, { messages, liveHtml, emptyMark }) {
  if (!el) return
  const rows = (messages || []).map(renderMessage).join('')
  el.innerHTML = rows + (liveHtml || '') || emptyHtml(emptyMark)
  el.scrollTop = el.scrollHeight
}

export { escapeHtml, renderMarkdown }
