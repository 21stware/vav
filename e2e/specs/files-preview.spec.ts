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
