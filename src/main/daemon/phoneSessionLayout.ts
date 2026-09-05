import assert from 'node:assert/strict'

/** Geometry the desktop session column must keep in web / extension Chrome. */
export type PhoneSessionLayout = {
  composerWidth: number
  composerHeight: number
  composerTop: number
  viewportWidth: number
  viewportHeight: number
  agentWidth: number
  previewWidth: number
  previewCollapsed: boolean
  selectFileVisible: boolean
  pageChipOverlapsComposer: boolean
}

/** Runs in the page. Measures the desktop composer dock, not a crushed strip. */
export function readPhoneSessionLayout(): PhoneSessionLayout {
  const composer =
    document.querySelector('.composer-box') ?? document.querySelector('.composer')
  const agent =
    document.querySelector('.workspace-view-agent') ?? document.querySelector('.detail')
  const preview = document.querySelector('.workspace-view-preview')
  const box = composer?.getBoundingClientRect()
  const agentBox = agent?.getBoundingClientRect()
  const previewBox = preview?.getBoundingClientRect()
  const empty = document.querySelector('.workspace-preview-empty')
  const chip = document.getElementById('pageChip')
  const chipBox = chip && !chip.hidden ? chip.getBoundingClientRect() : null
  const previewHidden =
    !preview ||
    preview.classList.contains('is-collapsed') ||
    (previewBox?.width ?? 0) < 8 ||
    (preview ? getComputedStyle(preview).visibility === 'hidden' : true)
  const emptyStyle = empty ? getComputedStyle(empty) : null
  return {
    composerWidth: box?.width ?? 0,
    composerHeight: box?.height ?? 0,
    composerTop: box?.top ?? 0,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    agentWidth: agentBox?.width ?? 0,
    previewWidth: previewBox?.width ?? 0,
    previewCollapsed: previewHidden,
    selectFileVisible: Boolean(
      !previewHidden &&
        empty &&
        emptyStyle &&
        emptyStyle.visibility !== 'hidden' &&
        emptyStyle.display !== 'none' &&
        (previewBox?.width ?? 0) > 40
    ),
    pageChipOverlapsComposer: Boolean(
      box &&
        chipBox &&
        chipBox.width > 8 &&
        chipBox.height > 8 &&
        chipBox.bottom > box.top + 4 &&
        chipBox.top < box.bottom - 4 &&
        chipBox.right > box.left + 4 &&
        chipBox.left < box.right - 4
    )
  }
}

export function assertDesktopSessionLayout(
  layout: PhoneSessionLayout,
  minComposerWidth: number
): void {
  assert.ok(
    layout.composerWidth >= minComposerWidth,
    `composer crushed to ${Math.round(layout.composerWidth)}px (need ≥ ${minComposerWidth})`
  )
  assert.ok(
    layout.composerWidth > layout.composerHeight,
    `composer is a vertical strip ${Math.round(layout.composerWidth)}×${Math.round(layout.composerHeight)}`
  )
  assert.ok(
    layout.composerTop > layout.viewportHeight * 0.35,
    `composer is not the bottom dock (top=${Math.round(layout.composerTop)} in ${layout.viewportHeight}h)`
  )
  assert.ok(
    layout.agentWidth >= minComposerWidth,
    `agent column crushed to ${Math.round(layout.agentWidth)}px`
  )
  assert.ok(
    layout.previewCollapsed || layout.previewWidth < 8,
    `file preview drawer is open (${Math.round(layout.previewWidth)}px) and eats the session column`
  )
  assert.equal(layout.selectFileVisible, false, 'file-preview empty state is covering the session')
  assert.equal(
    layout.pageChipOverlapsComposer,
    false,
    'current-tab chip is covering the composer dock'
  )
}
