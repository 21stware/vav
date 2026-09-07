/**
 * Desktop `SessionRunPicker` order: [mode · permission]  model  [thinking · Fast]
 */
import { escapeHtml } from './markdown.js'

function fillSelect(el, choices, value, fallback) {
  if (!el) return
  const rows = choices && choices.length ? choices : fallback || []
  if (!rows.length) {
    el.hidden = true
    if (value) el.value = value
    return
  }
  el.hidden = false
  el.innerHTML = rows
    .map(
      (c) =>
        `<option value="${escapeHtml(c.id)}"${c.id === value ? ' selected' : ''}>${escapeHtml(c.label || c.id)}</option>`
    )
    .join('')
  if (value && ![...el.options].some((o) => o.value === value)) {
    const opt = document.createElement('option')
    opt.value = value
    opt.textContent = value
    opt.selected = true
    el.appendChild(opt)
  }
}

export function paintRunBar(root, controls) {
  const $ = (id) => root.getElementById?.(id) || document.getElementById(id)
  const model = $('model')
  const approval = $('approval')
  const mode = $('mode')
  const thinking = $('thinking')
  const fastBtn = $('fastBtn')
  if (!controls) return

  if (model) {
    const list = $('modelList')
    const rows = controls.models?.length
      ? controls.models
      : controls.model
        ? [{ id: controls.model, label: controls.model }]
        : []
    if (list) {
      list.innerHTML = rows
        .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.label || c.id)}</option>`)
        .join('')
    }
    if (controls.model) model.value = controls.model
  }

  fillSelect(
    approval,
    controls.approvals,
    controls.approval,
    [
      { id: 'auto', label: 'Normal' },
      { id: 'bypass', label: 'Bypass' },
      { id: 'edit', label: 'Read' }
    ]
  )

  if (mode) {
    fillSelect(mode, controls.modes, controls.mode)
    mode.hidden = !(controls.modes && controls.modes.length)
  }

  if (thinking) {
    const show = controls.thinking != null && controls.thinkingLevels?.length
    fillSelect(thinking, controls.thinkingLevels, controls.thinking)
    thinking.hidden = !show
  }

  if (fastBtn) {
    if (controls.fast == null) {
      fastBtn.hidden = true
    } else {
      fastBtn.hidden = false
      fastBtn.setAttribute('aria-pressed', controls.fast ? 'true' : 'false')
    }
  }
}

export function readRunPatch(root) {
  const $ = (id) => root.getElementById?.(id) || document.getElementById(id)
  const patch = {
    model: $('model')?.value.trim(),
    approvalMode: $('approval')?.value
  }
  const mode = $('mode')
  if (mode && !mode.hidden && mode.value) patch.mode = mode.value
  const thinking = $('thinking')
  if (thinking && !thinking.hidden && thinking.value) patch.thinkingLevel = thinking.value
  const fastBtn = $('fastBtn')
  if (fastBtn && !fastBtn.hidden) patch.fast = fastBtn.getAttribute('aria-pressed') === 'true'
  return patch
}

export function toggleFast(root) {
  const btn = (root.getElementById || document.getElementById).call(root, 'fastBtn')
  if (!btn || btn.hidden) return
  const next = btn.getAttribute('aria-pressed') !== 'true'
  btn.setAttribute('aria-pressed', next ? 'true' : 'false')
}
