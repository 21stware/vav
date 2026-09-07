import { tt } from '../i18n/useT'

function icon(path: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" ` +
    `stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    `${path}</svg>`
  )
}

const ICONS = {
  copy: icon(
    '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'
  ),
  copyText: icon('<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>'),
  copyImage: icon(
    '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>'
  ),
  check: icon('<path d="M20 6 9 17l-5-5"/>'),
  download: icon(
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>'
  ),
  view: icon(
    '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="M10 4v16"/><path d="M2 8h20"/>'
  )
}

function escapeAttr(title: string): string {
  return title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
}

function actionButton(
  action: string,
  title: string,
  svg: string,
  ack?: 'copy'
): string {
  const safe = escapeAttr(title)
  const copied = escapeAttr(tt('common.copied'))
  const inner =
    ack === 'copy'
      ? `<span class="md-block-glyph" aria-hidden="true">` +
        `<span class="md-block-glyph-idle">${svg}</span>` +
        `<span class="md-block-glyph-ok">${ICONS.check}</span></span>`
      : svg
  const ackAttrs =
    ack === 'copy' ? ` data-title-idle="${safe}" data-title-done="${copied}"` : ''
  return (
    `<button type="button" class="md-block-btn is-icon" data-md-action="${action}" ` +
    `title="${safe}" aria-label="${safe}"${ackAttrs}>${inner}</button>`
  )
}

export type MdActionSet = 'source' | 'visual' | 'image'

/** Copy source (T) / Copy image (clipboard) / Download / View in window. */
export function mdBlockActionButtons(set: MdActionSet): string {
  const copyTitle = set === 'source' ? tt('md.action.copy') : tt('md.action.copySource')
  const parts = [
    actionButton('copy', copyTitle, ICONS.copyText, 'copy'),
    ...(set === 'visual' || set === 'image'
      ? [actionButton('copy-image', tt('md.action.copyImage'), ICONS.copy, 'copy')]
      : []),
    actionButton('download', tt('md.action.download'), ICONS.download),
    actionButton('view-window', tt('md.action.viewInWindow'), ICONS.view)
  ]
  return `<span class="md-block-actions">${parts.join('')}</span>`
}
