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
    await expect(preview.locator('img, .file-viewer-image-scroll')).toHaveCount(1)
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
