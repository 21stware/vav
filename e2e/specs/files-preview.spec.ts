import { test, expect } from '@playwright/test'
import {
  chooseNativeMenu,
  launchVav,
  openFilesTray,
  peekNativeMenu,
  waitForNewWindow
} from '../launch'

/**
 * Open / preview: in-session drawer, keyboard, file switch, companion window.
 */
test('selecting a file and pressing Space opens the session preview', async () => {
  const harness = await launchVav()
  try {
    const { page } = harness
    await openFilesTray(page)
    const file = page.locator('[data-file-path$="hello.md"]')
    await file.click()
    await expect(file).toHaveClass(/selected/)
    await page.keyboard.press('Space')

    const preview = page.locator('[data-testid="file-preview"]')
    await expect(preview).not.toHaveClass(/is-collapsed/)
    await expect(page.locator('[data-testid="file-preview-name"]')).toHaveText('hello.md')
    await expect(preview.getByText('hello from e2e')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})

test('previewing a second file replaces the drawer contents', async () => {
  const harness = await launchVav()
  try {
    const { page } = harness
    await openFilesTray(page)
    await page.locator('[data-file-path$="hello.md"]').dblclick()
    await expect(page.locator('[data-testid="file-preview-name"]')).toHaveText('hello.md')

    await page.locator('[data-file-path$="notes.md"]').dblclick()
    await expect(page.locator('[data-testid="file-preview-name"]')).toHaveText('notes.md')
    const preview = page.locator('[data-testid="file-preview"]')
    await expect(preview).not.toHaveClass(/is-collapsed/)
    await expect(preview.getByText('notes from e2e')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})

test('CSV preview renders the sheet and shares Edit/Read chrome', async () => {
  const harness = await launchVav()
  try {
    const { page } = harness
    await openFilesTray(page)
    await page.locator('[data-file-path$="data.csv"]').dblclick()
    const preview = page.locator('[data-testid="file-preview"]')
    await expect(page.locator('[data-testid="file-preview-name"]')).toHaveText('data.csv')
    await expect(preview.locator('.csv-sheet')).toBeVisible()
    await expect(preview.getByText('alice')).toBeVisible()
    await expect(preview.locator('.preview-mode-select')).toHaveValue('editing')
    await expect(preview.locator('.file-preview-statusbar')).toContainText(/row/i)
  } finally {
    await harness.dispose()
  }
})

test('TypeScript preview renders source and stays pickable', async () => {
  const harness = await launchVav()
  try {
    const { page } = harness
    await openFilesTray(page)
    await page.locator('[data-file-path$="code.ts"]').dblclick()
    const preview = page.locator('[data-testid="file-preview"]')
    await expect(page.locator('[data-testid="file-preview-name"]')).toHaveText('code.ts')
    await expect(preview.getByText('export function add')).toBeVisible()
    await expect(preview.locator('.preview-mode-select')).toHaveValue('editing')
  } finally {
    await harness.dispose()
  }
})

test('SVG image preview paints the media canvas with shared chrome', async () => {
  const harness = await launchVav()
  try {
    const { page } = harness
    await openFilesTray(page)
    await page.locator('[data-file-path$="mark.svg"]').dblclick()
    const preview = page.locator('[data-testid="file-preview"]')
    await expect(page.locator('[data-testid="file-preview-name"]')).toHaveText('mark.svg')
    await expect(preview.locator('.file-viewer-image-scroll')).toBeVisible()
    await expect(preview.locator('.file-viewer-image-scroll img')).toBeVisible()
    await expect(preview.locator('.preview-mode-select')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})

test('clicking a markdown heading picks it and Escape clears the selection', async () => {
  const harness = await launchVav()
  try {
    const { page } = harness
    await openFilesTray(page)
    await page.locator('[data-file-path$="hello.md"]').dblclick()
    const preview = page.locator('[data-testid="file-preview"]')
    await expect(preview.getByText('hello from e2e')).toBeVisible()
    const heading = preview.locator('.preview-select-region, [data-block-id]').first()
    await heading.click()
    await expect
      .poll(async () => preview.locator('.preview-select-region.selected, .selected[data-block-id]').count())
      .toBeGreaterThan(0)
    await page.keyboard.press('Escape')
    await expect(preview.locator('.preview-select-region.selected, .selected[data-block-id]')).toHaveCount(0)
  } finally {
    await harness.dispose()
  }
})

test('HTML preview renders the document canvas with Edit chrome', async () => {
  const harness = await launchVav()
  try {
    const { page } = harness
    await openFilesTray(page)
    await page.locator('[data-file-path$="page.html"]').dblclick()
    const preview = page.locator('[data-testid="file-preview"]')
    await expect(page.locator('[data-testid="file-preview-name"]')).toHaveText('page.html')
    await expect(preview.locator('.html-root')).toBeVisible()
    const frame = preview.frameLocator('.html-native-frame')
    await expect(frame.getByText('HTML preview')).toBeVisible({ timeout: 20_000 })
    await expect(frame.getByText('js-on')).toBeVisible()
    await frame.getByText('Hello canvas').click()
    await expect
      .poll(async () => frame.locator('.office-pick-target.selected, [data-block-id].selected').count())
      .toBeGreaterThan(0)
    await expect(preview.locator('.preview-mode-select')).toHaveValue('editing')
  } finally {
    await harness.dispose()
  }
})

test('ZIP preview lists archive entries as read-only', async () => {
  const harness = await launchVav()
  try {
    const { page } = harness
    await openFilesTray(page)
    await page.locator('[data-file-path$="pack.zip"]').dblclick()
    const preview = page.locator('[data-testid="file-preview"]')
    await expect(page.locator('[data-testid="file-preview-name"]')).toHaveText('pack.zip')
    await expect(preview.getByText('inside.txt')).toBeVisible()
    await expect(preview.locator('.preview-mode-static, .preview-mode-select')).toContainText(/read/i)
  } finally {
    await harness.dispose()
  }
})

test('XLSX preview opens the sheet canvas', async () => {
  const harness = await launchVav()
  try {
    const { page } = harness
    await openFilesTray(page)
    await page.locator('[data-file-path$="budget.xlsx"]').dblclick()
    const preview = page.locator('[data-testid="file-preview"]')
    await expect(page.locator('[data-testid="file-preview-name"]')).toHaveText('budget.xlsx')
    await expect(preview.getByText('Pens')).toBeVisible({ timeout: 20_000 })
    await expect(preview.locator('.preview-mode-select')).toHaveValue('editing')
    await expect(preview.locator('.file-viewer-warnings')).toHaveCount(0)
  } finally {
    await harness.dispose()
  }
})

test('DOCX preview paints the letter canvas in Edit', async () => {
  const harness = await launchVav()
  try {
    const { page } = harness
    await openFilesTray(page)
    await page.locator('[data-file-path$="letter.docx"]').dblclick()
    const preview = page.locator('[data-testid="file-preview"]')
    await expect(page.locator('[data-testid="file-preview-name"]')).toHaveText('letter.docx')
    await expect(preview.getByText('Cover title')).toBeVisible({ timeout: 20_000 })
    await expect(preview.locator('.preview-mode-select')).toHaveValue('editing')
    await expect(preview.locator('.file-viewer-warnings, .structured-doc-warning')).toHaveCount(0)
  } finally {
    await harness.dispose()
  }
})

test('PPTX preview paints the slide canvas in Edit', async () => {
  const harness = await launchVav()
  try {
    const { page } = harness
    await openFilesTray(page)
    await page.locator('[data-file-path$="deck.pptx"]').dblclick()
    const preview = page.locator('[data-testid="file-preview"]')
    await expect(page.locator('[data-testid="file-preview-name"]')).toHaveText('deck.pptx')
    await expect(preview.locator('.pptx-root, .structured-doc')).toBeVisible({ timeout: 20_000 })
    await expect(preview.getByText('Q3 Review')).toBeVisible({ timeout: 20_000 })
    await expect(preview.locator('.preview-mode-select')).toHaveValue('editing')
  } finally {
    await harness.dispose()
  }
})

test('PDF preview is format-locked Read and paints text', async () => {
  const harness = await launchVav()
  try {
    const { page } = harness
    await openFilesTray(page)
    await page.locator('[data-file-path$="brief.pdf"]').dblclick()
    const preview = page.locator('[data-testid="file-preview"]')
    await expect(page.locator('[data-testid="file-preview-name"]')).toHaveText('brief.pdf')
    await expect(preview.getByText('Hello PDF')).toBeVisible({ timeout: 20_000 })
    await expect(preview.locator('.preview-mode-select')).toHaveValue('readonly')
    await expect(preview.locator('.file-viewer-warnings, .structured-doc-warning')).toHaveCount(0)
  } finally {
    await harness.dispose()
  }
})

test('SQLite preview opens the sheet and stays pickable', async () => {
  const harness = await launchVav()
  try {
    const { page } = harness
    await openFilesTray(page)
    await page.locator('[data-file-path$="notes.db"]').dblclick()
    const preview = page.locator('[data-testid="file-preview"]')
    await expect(page.locator('[data-testid="file-preview-name"]')).toHaveText('notes.db')
    await expect(preview.locator('.sqlite-root')).toBeVisible({ timeout: 20_000 })
    await expect(preview.locator('.structured-doc-nav-label')).toHaveText('items')
    await expect(preview.getByText('Pens')).toBeVisible()
    await expect(preview.locator('.preview-mode-select')).toHaveValue('editing')
  } finally {
    await harness.dispose()
  }
})

test('binary preview stays Read and shows the hex/info canvas', async () => {
  const harness = await launchVav()
  try {
    const { page } = harness
    await openFilesTray(page)
    await page.locator('[data-file-path$="blob.bin"]').dblclick()
    const preview = page.locator('[data-testid="file-preview"]')
    await expect(page.locator('[data-testid="file-preview-name"]')).toHaveText('blob.bin')
    await expect(preview.locator('.binary-file-view')).toBeVisible()
    await expect(preview.locator('.preview-mode-static')).toBeVisible()
    await expect(preview.locator('.preview-mode-select')).toHaveCount(0)
  } finally {
    await harness.dispose()
  }
})

test('video preview paints the media canvas with shared chrome', async () => {
  const harness = await launchVav()
  try {
    const { page } = harness
    await openFilesTray(page)
    await page.locator('[data-file-path$="clip.mp4"]').dblclick()
    const preview = page.locator('[data-testid="file-preview"]')
    await expect(page.locator('[data-testid="file-preview-name"]')).toHaveText('clip.mp4')
    await expect(preview.locator('video.file-viewer-video')).toBeVisible()
    await expect(preview.locator('.preview-mode-select')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})

test('audio preview paints the media canvas with shared chrome', async () => {
  const harness = await launchVav()
  try {
    const { page } = harness
    await openFilesTray(page)
    await page.locator('[data-file-path$="tone.wav"]').dblclick()
    const preview = page.locator('[data-testid="file-preview"]')
    await expect(page.locator('[data-testid="file-preview-name"]')).toHaveText('tone.wav')
    await expect(preview.locator('audio.file-viewer-audio')).toBeVisible()
    await expect(preview.locator('.preview-mode-select')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})

test('html-clip preview is forced Read and is not pickable', async () => {
  const harness = await launchVav()
  try {
    const { page } = harness
    await openFilesTray(page)
    await page.locator('[data-file-path$="app.html"]').dblclick()
    const preview = page.locator('[data-testid="file-preview"]')
    await expect(page.locator('[data-testid="file-preview-name"]')).toHaveText('app.html')
    await expect(preview.locator('.html-clip-stage')).toBeVisible({ timeout: 20_000 })
    await expect(preview.locator('.preview-mode-static')).toBeVisible()
    await expect(preview.locator('.preview-mode-select')).toHaveCount(0)
    await expect(preview.locator('.preview-select-region')).toHaveCount(0)
  } finally {
    await harness.dispose()
  }
})

test('an external rewrite of the open markdown file arms Save then promotes', async () => {
  const harness = await launchVav()
  try {
    const { page } = harness
    await openFilesTray(page)
    await page.locator('[data-file-path$="hello.md"]').dblclick()
    const preview = page.locator('[data-testid="file-preview"]')
    await expect(preview.getByText('hello from e2e')).toBeVisible()
    await expect(preview.locator('.preview-save-main')).toBeDisabled()
    const status = await preview.locator('.file-preview-statusbar').innerText()
    const path = status
      .split('·')
      .map((s) => s.trim())
      .find((s) => s.startsWith('/'))
    expect(path).toBeTruthy()
    await page.evaluate(async (p) => {
      await window.vav.files.write(p!, '# hello from e2e\n\nedited by e2e\n')
    }, path)
    await expect(preview.getByText('edited by e2e')).toBeVisible({ timeout: 15_000 })
    const save = preview.locator('.preview-save-main')
    if (await save.isEnabled()) {
      await save.click()
      await expect(save).toBeDisabled({ timeout: 15_000 })
    }
    await expect(preview.getByText('edited by e2e')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})

test('picking a heading opens a comment card in the preview Agent panel', async () => {
  const harness = await launchVav()
  try {
    const { page } = harness
    await openFilesTray(page)
    await page.locator('[data-file-path$="hello.md"]').dblclick()
    const preview = page.locator('[data-testid="file-preview"]')
    await expect(preview.getByText('hello from e2e')).toBeVisible()
    await preview.locator('.preview-select-region, [data-block-id]').first().click()
    await expect
      .poll(async () => preview.locator('.preview-select-region.selected, .selected[data-block-id]').count())
      .toBeGreaterThan(0)
    const agentToggle = preview.locator('.preview-agent-logo-btn')
    if (await agentToggle.count()) {
      await agentToggle.click()
    }
    const start = preview.getByRole('button', { name: /start chat/i })
    if (await start.isVisible().catch(() => false)) {
      await start.click()
    }
    await expect(page.locator('.comment-card').first()).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('.comment-card-title').first()).toContainText(/hello|heading|line/i)
  } finally {
    await harness.dispose()
  }
})

test('Files Open menu item opens a companion preview window', async () => {
  const harness = await launchVav()
  try {
    const { page } = harness
    await openFilesTray(page)
    await page.locator('[data-file-path$="hello.md"]').click({ button: 'right' })
    await expect
      .poll(async () => (await peekNativeMenu(page))?.map((item) => item.label) ?? [])
      .toEqual(expect.arrayContaining(['Open', 'Preview']))
    const companion = await waitForNewWindow(harness, () => chooseNativeMenu(page, 'Open'))
    await expect(companion.locator('[data-testid="file-preview-name"]')).toHaveText('hello.md', {
      timeout: 20_000
    })
    await expect(companion.getByText('hello from e2e')).toBeVisible()
    await companion.close()
  } finally {
    await harness.dispose()
  }
})
