import { test, expect } from '@playwright/test'
import { chooseNativeMenu, launchWorkbench, peekNativeMenu, waitForNewWindow } from '../launch'

/**
 * session/sidebar-conversation-list.rpml + session/main-chat-empty.rpml
 */
test('sidebar lists the session, groups by workspace, and archives stay reachable', async () => {
  const harness = await launchWorkbench()
  try {
    const { page } = harness
    await expect(page.locator('[data-testid="sidebar"]')).toBeVisible()
    await expect(page.locator('[data-testid="session-detail"]')).toBeVisible()
    await expect(page.getByText('E2E session')).toBeVisible()
    await expect(page.locator('[data-testid="sidebar-category-bar"]')).toBeVisible()
    await expect(page.locator('[data-testid="sidebar-category-task"]')).toHaveAttribute(
      'data-expanded',
      'true'
    )
    await expect(page.locator('[data-testid="sidebar-category-file"]')).toBeVisible()
    await expect(page.locator('[data-testid="sidebar-category-scheduled"]')).toBeVisible()
    await expect(page.locator('[data-testid="sidebar-category-archived"]')).toBeVisible()
    await expect(page.locator('[data-testid="sidebar-list-menu"]')).toHaveAttribute(
      'data-grouping',
      'workspace'
    )
    await expect(page.locator('[data-testid="sidebar-list-menu"]')).toHaveAttribute(
      'data-filter',
      'none'
    )
    await expect(page.locator('[data-testid="sidebar-connect"]')).toBeVisible()
    await page.locator('[data-testid="sidebar-list-menu"]').click()
    await expect
      .poll(async () => (await peekNativeMenu(page))?.map((item) => item.label) ?? [])
      .toEqual(expect.arrayContaining(['Group by', 'Workspace', 'Filter', 'None']))
    await chooseNativeMenu(page, 'None')
    await expect(page.locator('[data-testid="sidebar-list-menu"]')).toHaveAttribute(
      'data-grouping',
      'none'
    )
    await expect(page.getByText('E2E session')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})

test('Remote Tunnel menu opens Settings Connect with phone and machine pairing', async () => {
  const harness = await launchWorkbench()
  try {
    const { page } = harness
    const settings = await waitForNewWindow(harness, async () => {
      await page.locator('[data-testid="sidebar-connect"]').click()
      await chooseNativeMenu(page, 'Pair another device…')
    })
    await expect(settings.locator('[data-testid="settings-window"]')).toBeVisible()
    await expect(settings.locator('[data-testid="settings-nav-connect"]')).toBeVisible()
    // Incoming (phone / QR) stacked above outgoing (pair a remote machine).
    await expect(settings.locator('[data-testid="settings-machines"]')).toContainText(
      'Join remote tunnel'
    )
    await expect(settings.locator('[data-testid="connect-panel-incoming"]')).toContainText(
      'Allow remote tunnel'
    )
    await expect(settings.locator('[data-testid="settings-remote-enabled"]')).toBeVisible()
    await expect(settings.locator('[data-testid="settings-machines-pair-input"]')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})

test('new session is created and selected', async () => {
  const harness = await launchWorkbench()
  try {
    const { page } = harness
    await page.locator('[data-testid="new-session"]').click()
    await expect(page.getByText('New session')).toBeVisible()
    await expect(page.getByText('E2E session')).toBeVisible()
    await expect(page.locator('.empty-state-session')).toBeVisible()
    await expect(page.locator('[data-testid="tools-panel"]')).toHaveAttribute(
      'data-tools-collapsed',
      'true'
    )
  } finally {
    await harness.dispose()
  }
})

test('Archived category opens the empty archive list and Task restores grouping', async () => {
  const harness = await launchWorkbench()
  try {
    const { page } = harness
    await page.locator('[data-testid="sidebar-category-archived"]').click()
    await expect(page.getByText('No archived sessions').first()).toBeVisible()
    await expect(page.locator('[data-testid="sidebar-list-menu"]')).toHaveCount(0)
    await page.locator('[data-testid="sidebar-category-task"]').click()
    await expect(page.locator('[data-testid="sidebar-list-menu"]')).toBeVisible()
    await expect(page.getByText('E2E session')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})

test('File category shows the file-session empty state', async () => {
  const harness = await launchWorkbench()
  try {
    const { page } = harness
    await page.locator('[data-testid="sidebar-category-file"]').click()
    await expect(page.getByText('No file sessions').first()).toBeVisible()
    await expect(page.locator('[data-testid="open-a-file"]')).toBeVisible()
    await expect(page.locator('[data-testid="sidebar-list-menu"]')).toHaveCount(0)
    await page.locator('[data-testid="sidebar-category-task"]').click()
    await expect(page.locator('[data-testid="sidebar-list-menu"]')).toBeVisible()
    await expect(page.getByText('E2E session')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})

test('Scheduled category switches the list and the detail pane', async () => {
  const harness = await launchWorkbench()
  try {
    const { page } = harness
    await expect(page.locator('[data-testid="composer-input"]')).toBeVisible()
    await page.locator('[data-testid="sidebar-category-scheduled"]').click()
    await expect(page.locator('[data-testid="sidebar-category-scheduled"]')).toHaveAttribute(
      'data-expanded',
      'true'
    )
    await expect(page.locator('[data-testid="timer-jobs"]')).toBeVisible()
    await expect(page.getByText('No scheduled tasks')).toHaveCount(0)
    await expect(page.locator('[data-testid="schedule-editor"]')).toBeVisible()
    await expect(page.locator('[data-testid="timer-mode"]')).toBeVisible()
    await expect(page.locator('[data-testid="timer-workspace"]')).toBeVisible()
    await expect(page.locator('[data-testid="timer-workspace"]')).toHaveValue('mint')
    await expect(page.locator('[data-testid="timer-prompt"]')).toBeVisible()
    await expect(page.locator('[data-testid="timer-enabled"]')).toBeVisible()
    await expect(page.locator('[data-testid="timer-run-now"]')).toBeVisible()
    await expect(page.locator('[data-testid="composer-input"]')).toHaveCount(0)
    await page.locator('[data-testid="sidebar-category-task"]').click()
    await expect(page.locator('[data-testid="composer-input"]')).toBeVisible()
    await expect(page.getByText('E2E session')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})

test('sidebar search filters by title', async () => {
  const harness = await launchWorkbench()
  try {
    const { page } = harness
    await page.locator('[data-testid="sidebar-search-toggle"]').click()
    const search = page.locator('[data-testid="sidebar-search"]')
    await search.fill('zzz-no-such-session')
    await expect(page.getByText('No matching sessions')).toBeVisible()
    await search.fill('E2E')
    await expect(page.getByText('E2E session')).toBeVisible()
    await expect(page.getByText('No matching sessions')).toHaveCount(0)
  } finally {
    await harness.dispose()
  }
})
