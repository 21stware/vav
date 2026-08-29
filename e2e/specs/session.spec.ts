import { test, expect } from '@playwright/test'
import { chooseNativeMenu, launchVav, waitForNewWindow } from '../launch'

/**
 * session/sidebar-conversation-list.rpml + session/main-chat-empty.rpml
 */
test('sidebar lists the session, groups by workspace, and archives stay reachable', async () => {
  const harness = await launchVav()
  try {
    const { page } = harness
    await expect(page.locator('[data-testid="sidebar"]')).toBeVisible()
    await expect(page.locator('[data-testid="session-detail"]')).toBeVisible()
    await expect(page.getByText('E2E session')).toBeVisible()
    await expect(page.locator('[data-testid="sidebar-grouping"]')).toHaveValue('workspace')
    await expect(page.locator('[data-testid="sidebar-connect"]')).toBeVisible()
    await page.locator('[data-testid="sidebar-grouping"]').selectOption('none')
    await expect(page.getByText('E2E session')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})

test('Connect button pops the connect window with phone and machine pairing', async () => {
  const harness = await launchVav()
  try {
    const { page } = harness
    const connect = await waitForNewWindow(harness, async () => {
      await page.locator('[data-testid="sidebar-connect"]').click()
    })
    await expect(connect.locator('[data-testid="connect-window"]')).toBeVisible()
    // Two panels: 连接到 (pair a remote machine) + 被连接 (phone / incoming).
    await expect(connect.locator('[data-testid="settings-machines"]')).toContainText('Connect to')
    await expect(connect.locator('[data-testid="connect-panel-incoming"]')).toContainText(
      'Connected by'
    )
    await expect(connect.locator('[data-testid="settings-remote-enabled"]')).toBeVisible()
    await expect(connect.locator('[data-testid="settings-machines-pair-input"]')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})

test('new session is created and selected', async () => {
  const harness = await launchVav()
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

test('Archived menu item opens the empty archive list and back restores grouping', async () => {
  const harness = await launchVav()
  try {
    const { page } = harness
    await page.locator('[data-testid="sidebar-more"]').click()
    await chooseNativeMenu(page, 'Archived')
    await expect(page.getByText('No archived sessions')).toBeVisible()
    await expect(page.locator('[data-testid="sidebar-grouping"]')).toHaveCount(0)
    await page.locator('[data-testid="sidebar-archive-back"]').click()
    await expect(page.locator('[data-testid="sidebar-grouping"]')).toBeVisible()
    await expect(page.getByText('E2E session')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})

test('sidebar search filters by title', async () => {
  const harness = await launchVav()
  try {
    const { page } = harness
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
