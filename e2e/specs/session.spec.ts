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
    await expect(page.locator('[data-testid="agent-column"]')).toBeVisible()
    await expect(page.locator('[data-testid="session-detail"]')).toBeVisible()
    await expect(page.locator('[data-testid="close-app"]')).toBeVisible()
    await expect(page.locator('[data-testid="composer-input"]')).toBeVisible()
    await expect(page.getByText('E2E session')).toBeVisible()
    await expect(page.locator('[data-testid="sidebar"]')).toBeVisible()
    await expect(page.locator('[data-testid="sidebar-primary-nav"]')).toBeVisible()
    await expect(page.locator('[data-testid="new-session"]')).toBeVisible()
    await expect(page.locator('[data-testid="new-scheduled"]')).toBeVisible()
    await expect(page.locator('[data-testid="applications-tab-storage"]')).toBeVisible()
    await expect(page.locator('[data-testid="applications-tab-data"]')).toBeVisible()
    await expect(page.locator('[data-testid="applications-tab-knowledge"]')).toBeVisible()
    await expect(page.locator('[data-testid="sidebar-connect"]')).toBeVisible()
    await expect(page.locator('[data-testid="app-column"]')).toBeVisible()
    await expect(page.locator('[data-testid="applications-panel"]')).toBeVisible()
    await expect(page.locator('[data-testid="applications-tab-storage"]')).toHaveAttribute(
      'data-active',
      'true'
    )
    await expect(page.locator('[data-testid="sidebar-category-bar"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="sidebar-list-menu"]')).toHaveAttribute(
      'data-grouping',
      'workspace'
    )
    await expect(page.locator('[data-testid="sidebar-list-menu"]')).toHaveAttribute(
      'data-filter',
      'none'
    )
    await page.locator('[data-testid="sidebar-list-menu"]').click()
    await expect
      .poll(async () => (await peekNativeMenu(page))?.map((item) => item.label) ?? [])
      .toEqual(
        expect.arrayContaining([
          'Group by',
          'Workspace',
          'Filter',
          'None',
          'Running and unread',
          'Target',
          'All',
          'File',
          'Knowledge',
          'Data'
        ])
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
      'Join Remote Tunnel'
    )
    await expect(settings.locator('[data-testid="connect-panel-incoming"]')).toContainText(
      'Allow Remote Tunnel'
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
    await expect(page.locator('[data-testid="session-row"]')).toHaveCount(1)
    await expect(page.locator('[data-testid="session-row"]').getByText('E2E session')).toBeVisible()
    await expect(page.locator('.empty-state-session')).toBeVisible()
    await expect(page.locator('[data-testid="composer-input"]')).toBeVisible()
    await expect(page.locator('[data-testid="tools-panel"]')).toHaveAttribute(
      'data-tools-collapsed',
      'true'
    )
    await page.locator('[data-testid="close-app"]').click()
    await expect(page.locator('[data-testid="app-column"]')).toBeHidden()
    await page.locator('[data-testid="new-session"]').click()
    await expect(page.locator('[data-testid="agent-column"]')).toBeVisible()
    await expect(page.locator('.empty-state-session')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})

test('Archived menu opens the empty archive list and Devices restores the session list', async () => {
  const harness = await launchWorkbench()
  try {
    const { page } = harness
    await page.locator('[data-testid="sidebar-list-menu"]').click()
    await chooseNativeMenu(page, 'Archived')
    await expect(page.getByText('No archived sessions').first()).toBeVisible()
    await expect(page.locator('[data-testid="sidebar-list-menu"]')).toBeVisible()
    await page.locator('[data-testid="sidebar-list-menu"]').click()
    await chooseNativeMenu(page, 'Archived')
    await expect(page.locator('[data-testid="sidebar-list-menu"]')).toBeVisible()
    await expect(page.getByText('E2E session')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})

test('Storage application shows recent files and Open File', async () => {
  const harness = await launchWorkbench()
  try {
    const { page } = harness
    await page.locator('[data-testid="applications-tab-storage"]').click()
    await expect(page.locator('[data-testid="applications-tab-storage"]')).toHaveAttribute(
      'data-active',
      'true'
    )
    await expect(page.locator('[data-testid="file-recents"]')).toBeVisible()
    await expect(page.locator('[data-testid="file-source-select"]')).toHaveValue('recent')
    await expect(page.locator('[data-testid="file-source-select"]')).toContainText('Recent files')
    await expect(page.locator('[data-testid="file-source-select"] option[value="thisMac"]')).toHaveText(
      'This Mac'
    )
    await expect(page.locator('[data-testid="file-source-select"] option[value="icloud"]')).toHaveText(
      'iCloud'
    )
    await expect(page.locator('[data-testid="file-source-select"] option[value="cloudDisk"]')).toHaveText(
      'CloudDisk'
    )
    await expect(page.locator('[data-testid="open-a-file"]')).toBeVisible()
    await expect(page.locator('[data-testid="file-mac-browser"]')).toHaveCount(0)
    await page.locator('[data-testid="file-source-select"]').selectOption('thisMac')
    await expect(page.locator('[data-testid="file-mac-browser"]')).toBeVisible()
    await expect(page.locator('[data-testid="file-mac-path"]')).toBeVisible()
    await expect(page.locator('[data-testid="file-mac-home"]')).toBeVisible()
    await expect(page.locator('[data-testid="open-a-file"]')).toHaveCount(0)
    await page.locator('[data-testid="file-source-select"]').selectOption('cloudDisk')
    await expect(page.getByText('CloudDisk coming soon')).toBeVisible()
    await expect(page.locator('[data-testid="sidebar-list-menu"]')).toBeVisible()
    await expect(page.getByText('E2E session')).toBeVisible()
    await expect(page.locator('[data-testid="composer-input"]')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})

test('File list Back to file list returns to This Mac or Recent files', async () => {
  const harness = await launchWorkbench()
  try {
    const { page, workspace } = harness
    await page.locator('[data-testid="applications-tab-storage"]').click()
    await page.locator('[data-testid="file-source-select"]').selectOption('thisMac')
    await expect(page.locator('[data-testid="file-mac-browser"]')).toBeVisible()
    await page.locator('[data-testid="file-mac-path"]').fill(workspace)
    await page.locator('[data-testid="file-mac-path"]').press('Enter')
    await expect(page.locator('[data-testid="remote-folder-entry-hello.md"]')).toBeVisible()
    await page.locator('[data-testid="remote-folder-entry-hello.md"]').dblclick()
    await expect(page.locator('[data-testid="file-preview-name"]')).toHaveText('hello.md')
    await expect(page.locator('[data-testid="applications-object-detail"]')).toBeVisible()
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

test('Scheduled task lives in the app, not the session list', async () => {
  const harness = await launchWorkbench()
  try {
    const { page } = harness
    await expect(page.locator('[data-testid="composer-input"]')).toBeVisible()
    await expect(page.getByText('E2E session')).toBeVisible()
    await page.locator('[data-testid="new-scheduled"]').click()
    await expect(page.locator('[data-testid="new-scheduled"]')).toHaveAttribute('data-active', 'true')
    await expect(page.locator('[data-testid="scheduled-home"]')).toBeVisible()
    await expect(page.locator('[data-testid="session-row"]')).toHaveCount(1)
    await page.locator('[data-testid="sidebar-create-scheduled"]').click()
    await expect(page.locator('[data-testid="session-row"]')).toHaveCount(1)
    await expect(page.locator('[data-testid="schedule-editor"]')).toBeVisible()
    await expect(page.locator('[data-testid="timer-mode"]')).toBeVisible()
    await expect(page.locator('[data-testid="timer-workspace"]')).toBeVisible()
    await expect(page.locator('[data-testid="timer-workspace"]')).toHaveValue('mint')
    await expect(page.locator('[data-testid="timer-prompt"]')).toBeVisible()
    await expect(page.locator('[data-testid="timer-enabled"]')).toBeVisible()
    await expect(page.locator('[data-testid="timer-run-now"]')).toBeVisible()
    await expect(page.locator('[data-testid="session-row"]').getByText('E2E session')).toBeVisible()
    await page.locator('[data-testid="session-row"]').filter({ hasText: 'E2E session' }).click()
    await expect(page.locator('[data-testid="composer-input"]')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})

test('Data application create opens the connection editor', async () => {
  const harness = await launchWorkbench()
  try {
    const { page } = harness
    await page.locator('[data-testid="applications-tab-data"]').click()
    await expect(page.locator('[data-testid="applications-tab-data"]')).toHaveAttribute(
      'data-active',
      'true'
    )
    await expect(page.locator('[data-testid="data-home"]')).toBeVisible()
    await expect(page.locator('[data-testid="db-table-row"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="db-group-header"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="db-table-tab"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="empty-create-db"]')).toBeVisible()
    const before = await page.locator('[data-testid="data-object-row"]').count()
    await page.locator('[data-testid="empty-create-db"]').click()
    await expect(page.locator('[data-testid="data-object-row"]')).toHaveCount(before + 1)
    await expect(page.locator('[data-testid="db-connect-editor"]')).toBeVisible()
    await expect(page.locator('[data-testid="db-driver"]')).toHaveValue('postgres')
    await expect(page.locator('[data-testid="db-use-url"]')).toBeVisible()
    await expect(page.locator('[data-testid="db-host"]')).toBeVisible()
    await expect(page.locator('[data-testid="db-connect"]')).toBeVisible()
    await expect(page.locator('[data-testid="composer-input"]')).toBeVisible()
    await expect(page.locator('[data-testid="session-row"]').getByText('E2E session')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})

test('Knowledge application starts empty, then create opens a note', async () => {
  const harness = await launchWorkbench()
  try {
    const { page } = harness
    await page.locator('[data-testid="applications-tab-knowledge"]').click()
    await expect(page.locator('[data-testid="applications-tab-knowledge"]')).toHaveAttribute(
      'data-active',
      'true'
    )
    await expect(page.getByText('No knowledge yet')).toBeVisible()
    await expect(page.locator('[data-testid="empty-create-note"]')).toBeVisible()
    await page.locator('[data-testid="empty-create-note"]').click()
    await expect(page.locator('[data-testid="knowledge-workspace"]')).toBeVisible()
    await expect(page.locator('[data-testid="knowledge-note-editor"]')).toBeVisible()
    await expect(page.locator('[data-testid="composer-input"]')).toBeVisible()
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
