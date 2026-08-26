import { test, expect } from '@playwright/test'
import { launchVav, openFilesTray } from '../launch'

/**
 * files/files-panel.rpml — Files + Git always on; tree preview on double-click.
 * Session file drawer is the shipped preview (not the companion window).
 */
test('Files tray lists workspace files and opens a session preview', async () => {
  const harness = await launchVav()
  try {
    const { page } = harness
    await openFilesTray(page)
    await expect(page.locator('[data-testid="segment-files"]')).toBeVisible()
    await expect(page.locator('[data-testid="segment-git"]')).toBeVisible()
    await expect(page.locator('[data-testid="files-new-file"]')).toBeVisible()
    await expect(page.locator('[data-testid="files-view-mode"]')).toBeVisible()

    const file = page.locator('[data-file-path$="hello.md"]')
    await expect(file).toBeVisible()
    await file.dblclick()

    const preview = page.locator('[data-testid="file-preview"]')
    await expect(preview).not.toHaveClass(/is-collapsed/)
    await expect(page.locator('[data-testid="file-preview-name"]')).toHaveText('hello.md')
    await expect(preview.getByText('hello from e2e')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})

test('Git tab stays available and swaps the Files toolbar', async () => {
  const harness = await launchVav()
  try {
    const { page } = harness
    await openFilesTray(page)
    await page.locator('[data-testid="segment-git"]').click()
    await expect(page.locator('[data-testid="git-panel"]')).toBeVisible()
    await expect(page.locator('[data-testid="files-new-file"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="files-view-mode"]')).toHaveCount(0)
    await page.locator('[data-testid="segment-files"]').click()
    await expect(page.locator('[data-testid="files-new-file"]')).toBeVisible()
    await expect(page.locator('[data-testid="files-panel"]')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})

test('New file commits from the inline create row', async () => {
  const harness = await launchVav()
  try {
    const { page } = harness
    await openFilesTray(page)
    await page.locator('[data-testid="files-new-file"]').click()
    const name = page.locator('[data-testid="files-create-name"]')
    await expect(name).toBeVisible()
    await name.pressSequentially('note.md')
    await name.press('Enter')
    const created = page.locator('[data-file-path$="note.md"]')
    await expect(created).toBeVisible()
    await created.dblclick()
    await expect(page.locator('[data-testid="file-preview"]')).not.toHaveClass(/is-collapsed/)
    await expect(page.locator('[data-testid="file-preview-name"]')).toHaveText('note.md')
  } finally {
    await harness.dispose()
  }
})

test('Git tab explains a temp dir without version control', async () => {
  const harness = await launchVav()
  try {
    const { page } = harness
    await openFilesTray(page)
    await page.locator('[data-testid="segment-git"]').click()
    await expect(page.locator('[data-testid="git-panel"]')).toBeVisible()
    await expect(
      page.getByText(/temp dir without version control|not under version control/)
    ).toBeVisible()
    await expect(page.getByText('enable version control')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})

test('session preview close collapses the drawer', async () => {
  const harness = await launchVav()
  try {
    const { page } = harness
    await openFilesTray(page)
    await page.locator('[data-file-path$="hello.md"]').dblclick()
    const preview = page.locator('[data-testid="file-preview"]')
    await expect(preview).not.toHaveClass(/is-collapsed/)
    await page.locator('[data-testid="file-preview-close"]').click()
    await expect(preview).toHaveClass(/is-collapsed/)
  } finally {
    await harness.dispose()
  }
})

test('Files view can switch from tree to columns', async () => {
  const harness = await launchVav()
  try {
    const { page } = harness
    await openFilesTray(page)
    await page.locator('[data-testid="files-view-mode"]').click()
    await expect(page.locator('.file-columns')).toBeVisible()
    await expect(page.locator('[data-file-path$="hello.md"]')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})

test('seeded git repo lists the dirty file on the Git tab', async () => {
  const harness = await launchVav({ seedGit: true })
  try {
    const { page } = harness
    await openFilesTray(page)
    await page.locator('[data-testid="segment-git"]').click()
    await expect(page.locator('[data-testid="git-panel"]')).toBeVisible()
    await expect(page.locator('.git-panel-meta')).toContainText('main · 1 changes')
    const row = page.locator('.git-change-row')
    await expect(row).toHaveCount(1)
    await expect(row.locator('.git-status-modified')).toHaveText('M')
    await expect(row.locator('.git-change-path')).toHaveText('hello.md')
  } finally {
    await harness.dispose()
  }
})

test('double-clicking a git change opens the session diff drawer', async () => {
  const harness = await launchVav({ seedGit: true })
  try {
    const { page } = harness
    await openFilesTray(page)
    await page.locator('[data-testid="segment-git"]').click()
    const row = page.locator('.git-change-row')
    await expect(row).toBeVisible()
    await row.dblclick()

    const preview = page.locator('[data-testid="file-preview"]')
    await expect(preview).not.toHaveClass(/is-collapsed/)
    await expect(page.locator('.git-diff-filename')).toHaveText('hello.md')
    await expect(page.locator('.diff-line.add')).toContainText('changed from e2e')
  } finally {
    await harness.dispose()
  }
})
