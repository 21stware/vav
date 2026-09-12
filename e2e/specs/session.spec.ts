import { test, expect, type Page } from '@playwright/test'
import { chooseNativeMenu, launchWorkbench, peekNativeMenu, waitForNewWindow } from '../launch'

async function revealSidebarCategory(page: Page, label: string): Promise<void> {
  await page.locator('[data-testid="sidebar-category-config"]').click()
  await chooseNativeMenu(page, label)
}

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
    await expect(page.locator('[data-testid="sidebar-category-scheduled"]')).toBeVisible()
    await expect(page.locator('[data-testid="sidebar-category-file"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="sidebar-category-db"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="sidebar-category-archived"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="sidebar-category-config"]')).toBeVisible()
    await page.locator('[data-testid="sidebar-category-config"]').click()
    await expect
      .poll(async () => (await peekNativeMenu(page))?.map((item) => item.label) ?? [])
      .toEqual(expect.arrayContaining(['Show categories', 'Scheduled', 'File', 'DB', 'Archived']))
    await expect
      .poll(async () => (await peekNativeMenu(page))?.find((item) => item.label === 'Scheduled')?.checked)
      .toBe(true)
    await chooseNativeMenu(page, 'File')
    await expect(page.locator('[data-testid="sidebar-category-file"]')).toBeVisible()
    await expect(page.locator('[data-testid="sidebar-category-file"]')).toHaveAttribute(
      'data-expanded',
      'true'
    )
    await page.locator('[data-testid="sidebar-category-task"]').click()
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
      .toEqual(
        expect.arrayContaining(['Group by', 'Workspace', 'Filter', 'None', 'Running and unread'])
      )
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

test('Archived menu opens the empty archive list and Task restores grouping', async () => {
  const harness = await launchWorkbench()
  try {
    const { page } = harness
    await page.locator('[data-testid="sidebar-connect"]').click()
    await chooseNativeMenu(page, 'Archived')
    await expect(page.getByText('No archived sessions').first()).toBeVisible()
    await expect(page.locator('[data-testid="sidebar-list-menu"]')).toHaveCount(0)
    await page.locator('[data-testid="sidebar-category-task"]').click()
    await expect(page.locator('[data-testid="sidebar-list-menu"]')).toBeVisible()
    await expect(page.getByText('E2E session')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})

test('File category shows recent files and Open File in the detail pane', async () => {
  const harness = await launchWorkbench()
  try {
    const { page } = harness
    await revealSidebarCategory(page, 'File')
    await expect(page.locator('[data-testid="sidebar-category-file"]')).toHaveAttribute(
      'data-expanded',
      'true'
    )
    await expect(page.getByText('No file sessions').first()).toBeVisible()
    await expect(page.locator('[data-testid="file-recents"]')).toBeVisible()
    await expect(page.locator('[data-testid="file-source-select"]')).toHaveValue('recent')
    await expect(page.locator('[data-testid="file-source-select"]')).toContainText('Recent files')
    await expect(page.locator('[data-testid="file-source-select"] option[value="thisMac"]')).toHaveText(
      'This Mac'
    )
    await expect(page.locator('[data-testid="open-a-file"]')).toBeVisible()
    await expect(page.locator('[data-testid="file-mac-browser"]')).toHaveCount(0)
    await page.locator('[data-testid="file-source-select"]').selectOption('thisMac')
    await expect(page.locator('[data-testid="file-mac-browser"]')).toBeVisible()
    await expect(page.locator('[data-testid="file-mac-path"]')).toBeVisible()
    await expect(page.locator('[data-testid="file-mac-home"]')).toBeVisible()
    await expect(page.locator('[data-testid="open-a-file"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="sidebar-list-menu"]')).toHaveCount(0)
    await page.locator('[data-testid="sidebar-category-task"]').click()
    await expect(page.locator('[data-testid="sidebar-list-menu"]')).toBeVisible()
    await expect(page.getByText('E2E session')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})

test('File list Back to file list returns to This Mac or Recent files', async () => {
  const harness = await launchWorkbench()
  try {
    const { page, workspace } = harness
    await revealSidebarCategory(page, 'File')
    await page.locator('[data-testid="file-source-select"]').selectOption('thisMac')
    await expect(page.locator('[data-testid="file-mac-browser"]')).toBeVisible()
    await page.locator('[data-testid="file-mac-path"]').fill(workspace)
    await page.locator('[data-testid="file-mac-path"]').press('Enter')
    await expect(page.locator('[data-testid="remote-folder-entry-hello.md"]')).toBeVisible()
    await page.locator('[data-testid="remote-folder-entry-hello.md"]').dblclick()
    await expect(page.locator('[data-testid="file-preview-name"]')).toHaveText('hello.md')
    await expect(page.locator('[data-testid="back-to-file-list"]')).toBeVisible()
    await page.locator('[data-testid="back-to-file-list"]').click()
    await expect(page.locator('[data-testid="file-recents"]')).toBeVisible()
    await expect(page.locator('[data-testid="file-source-select"]')).toHaveValue('thisMac')
    await expect(page.locator('[data-testid="file-mac-browser"]')).toBeVisible()
    await expect(page.locator('[data-testid="file-mac-path"]')).toHaveValue(workspace)
    await page.locator('[data-testid="file-source-select"]').selectOption('recent')
    await expect(page.locator('[data-testid="file-recent-row"]')).toBeVisible()
    await page.locator('[data-testid="file-recent-row"]').click()
    await expect(page.locator('[data-testid="file-preview-name"]')).toHaveText('hello.md')
    await page.locator('[data-testid="back-to-file-list"]').click()
    await expect(page.locator('[data-testid="file-recents"]')).toBeVisible()
    await expect(page.locator('[data-testid="file-source-select"]')).toHaveValue('recent')
    await expect(page.locator('[data-testid="file-recent-row"]')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})

test('Scheduled category starts empty, then create selects the group for editing', async () => {
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
    await expect(page.getByText('No scheduled tasks')).toBeVisible()
    await expect(page.locator('[data-testid="timer-job-row"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="timer-session-row"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="schedule-editor"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="empty-create-scheduled"]')).toBeVisible()
    await page.locator('[data-testid="new-scheduled"]').click()
    await expect(page.locator('[data-testid="timer-job-row"]')).toHaveCount(1)
    await expect(page.locator('[data-testid="timer-job-row"]')).toHaveClass(/selected/)
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

test('DB category starts empty, then create selects the connection for editing', async () => {
  const harness = await launchWorkbench()
  try {
    const { page } = harness
    await revealSidebarCategory(page, 'DB')
    await expect(page.locator('[data-testid="sidebar-category-db"]')).toHaveAttribute(
      'data-expanded',
      'true'
    )
    await expect(page.locator('[data-testid="new-db"]')).toBeVisible()
    await expect(page.getByText('No database connections')).toBeVisible()
    await expect(page.locator('[data-testid="session-row"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="db-table-row"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="db-group-header"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="db-table-tab"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="db-connect-editor"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="empty-create-db"]')).toBeVisible()
    await page.locator('[data-testid="new-db"]').click()
    await expect(page.locator('[data-testid="session-row"]')).toHaveCount(1)
    await expect(page.locator('[data-testid="session-row"]')).toHaveClass(/selected/)
    await expect(page.locator('[data-testid="db-connect-editor"]')).toBeVisible()
    await expect(page.locator('[data-testid="db-driver"]')).toHaveValue('postgres')
    await expect(page.locator('[data-testid="db-use-url"]')).toBeVisible()
    await expect(page.locator('[data-testid="db-host"]')).toBeVisible()
    await expect(page.locator('[data-testid="db-connect"]')).toBeVisible()
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
    const search = page.locator('[data-testid="sidebar-search"]')
    await expect(search).toBeVisible()
    await search.fill('zzz-no-such-session')
    await expect(page.getByText('No matching sessions')).toBeVisible()
    await search.fill('E2E')
    await expect(page.getByText('E2E session')).toBeVisible()
    await expect(page.getByText('No matching sessions')).toHaveCount(0)
  } finally {
    await harness.dispose()
  }
})
