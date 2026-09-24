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
    await expect(page.locator('[data-testid="home-page"]')).toBeVisible()
    await expect(page.locator('[data-testid="new-session"]')).toBeVisible()
    await expect(page.locator('[data-testid="sidebar-history"]')).toBeHidden()
    await expect(page.locator('[data-testid="sidebar-services"]')).toBeVisible()
    await expect(page.locator('[data-testid="sidebar-services"]')).toHaveAttribute(
      'data-active',
      'true'
    )
    await expect(page.locator('[data-testid="sidebar-primary-nav"] [data-testid="new-scheduled"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="sidebar-connect"]')).toBeVisible()
    await expect(page.locator('[data-testid="app-column"]')).toBeVisible()
    await expect(page.locator('[data-testid="applications-panel"]')).toBeVisible()
    await expect(page.locator('[data-testid="app-mode-tabs"]')).toBeVisible()
    await expect(page.locator('[data-testid="new-scheduled"]')).toBeVisible()
    await expect(page.locator('[data-testid="applications-tab-storage"]')).toBeVisible()
    await expect(page.locator('[data-testid="applications-tab-data"]')).toBeVisible()
    await expect(page.locator('[data-testid="applications-tab-knowledge"]')).toBeVisible()
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
          'Notes',
          'Analysis'
        ])
      )
    await chooseNativeMenu(page, 'None')
    await expect(page.locator('[data-testid="sidebar-list-menu"]')).toHaveAttribute(
      'data-grouping',
      'none'
    )
    await expect(page.getByText('E2E session')).toBeVisible()
    await page.locator('#sessionsBtn').click()
    await expect(page.locator('[data-testid="list-column"]')).toHaveAttribute('data-collapsed', 'true')
    await expect(page.locator('[data-testid="new-session"]')).toBeVisible()
    await expect(page.locator('[data-testid="sidebar-history"]')).toBeVisible()
    await expect(page.locator('[data-testid="new-scheduled"]')).toBeVisible()
    await expect(page.locator('[data-testid="sidebar-search"]')).toBeHidden()
    await page.locator('[data-testid="sidebar-history"]').click()
    await expect
      .poll(async () => (await peekNativeMenu(page))?.map((item) => item.label) ?? [])
      .toEqual(expect.arrayContaining(['E2E session']))
    await chooseNativeMenu(page, 'E2E session')
    await page.locator('#sessionsBtn').click()
    await expect(page.locator('[data-testid="list-column"]')).not.toHaveAttribute('data-collapsed', 'true')
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
    await expect(page.locator('[data-testid="session-row"]')).toHaveCount(2)
    await expect(page.locator('[data-testid="session-row"]').getByText('E2E session')).toBeVisible()
    await expect(page.locator('[data-testid="session-row"].selected')).toBeVisible()
    await expect(page.locator('.empty-state-session')).toBeVisible()
    await expect(page.locator('[data-testid="composer-input"]')).toBeVisible()
    await expect(page.locator('[data-testid="agent-column"] [data-testid="composer-workspace"]')).toHaveCount(
      0
    )
    await expect(page.locator('.session-workspace-text-btn')).toContainText('Enter CLI Mode')
    await expect(page.locator('[data-testid="tools-panel"]')).toHaveAttribute(
      'data-tools-collapsed',
      'true'
    )
    await page.locator('[data-testid="close-app"]').click()
    await expect(page.locator('[data-testid="app-column"]')).toBeHidden()
    await expect(page.locator('[data-testid="sidebar-services"]')).toHaveAttribute(
      'data-active',
      'false'
    )
    await page.locator('[data-testid="new-session"]').click()
    await expect(page.locator('[data-testid="agent-column"]')).toBeVisible()
    await expect(page.locator('.empty-state-session')).toBeVisible()
    await page.locator('[data-testid="close-agent"]').click()
    await expect(page.locator('[data-testid="agent-column"]')).toBeHidden()
    await expect(page.locator('[data-testid="workbench-home"]')).toBeVisible()
    await expect(page.locator('[data-testid="workbench-home-insights"]')).toBeVisible()
    await expect(page.locator('[data-testid="workbench-home-nav"]')).toBeVisible()
    await expect(page.locator('[data-testid="workbench-home-composer"]')).toBeVisible()
    await expect(page.locator('[data-testid="workbench-home"] [data-testid="composer-input"]')).toBeVisible()
    await expect(page.locator('[data-testid="workbench-home"] [data-testid="composer-workspace"]')).toBeVisible()
    await expect(page.locator('[data-testid="workbench-home-sessions"]')).toBeVisible()
    await expect(page.locator('[data-testid="home-session-row"]').getByText('E2E session')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})

test('home page closes session and app columns', async () => {
  const harness = await launchWorkbench()
  try {
    const { page } = harness
    await expect(page.locator('[data-testid="agent-column"]')).toBeVisible()
    await expect(page.locator('[data-testid="app-column"]')).toBeVisible()
    await expect(page.locator('[data-testid="home-page"]')).toHaveAttribute('aria-pressed', 'false')
    await page.locator('[data-testid="home-page"]').click()
    await expect(page.locator('[data-testid="agent-column"]')).toBeHidden()
    await expect(page.locator('[data-testid="app-column"]')).toBeHidden()
    await expect(page.locator('[data-testid="workbench-home"]')).toBeVisible()
    await expect(page.locator('[data-testid="workbench-home-insights"]')).toBeVisible()
    await expect(page.locator('[data-testid="home-page"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('[data-testid="sidebar-services"]')).toHaveAttribute(
      'data-active',
      'false'
    )
  } finally {
    await harness.dispose()
  }
})

test('Services opens the right-hand panel and clears highlight when closed', async () => {
  const harness = await launchWorkbench()
  try {
    const { page } = harness
    await expect(page.locator('[data-testid="app-column"]')).toBeVisible()
    await expect(page.locator('[data-testid="sidebar-services"]')).toHaveAttribute(
      'data-active',
      'true'
    )
    await expect(page.locator('[data-testid="app-mode-tabs"]')).toBeVisible()
    await expect(page.locator('[data-testid="close-app"]')).toBeVisible()
    await page.locator('[data-testid="close-app"]').click()
    await expect(page.locator('[data-testid="app-column"]')).toBeHidden()
    await expect(page.locator('[data-testid="sidebar-services"]')).toHaveAttribute(
      'data-active',
      'false'
    )
    await page.locator('[data-testid="sidebar-services"]').click()
    await expect(page.locator('[data-testid="app-column"]')).toBeVisible()
    await expect(page.locator('[data-testid="applications-panel"]')).not.toHaveAttribute(
      'data-app',
      'devices'
    )
    await expect(page.locator('[data-testid="app-mode-tabs"]')).toBeVisible()
    await expect(page.locator('[data-testid="applications-tab-storage"]')).toBeVisible()
    await expect(page.locator('[data-testid="sidebar-services"]')).toHaveAttribute(
      'data-active',
      'true'
    )
    await expect(page.locator('[data-testid="app-chrome"]')).toHaveCount(0)
    await page.locator('[data-testid="sidebar-services"]').click()
    await expect(page.locator('[data-testid="app-column"]')).toBeHidden()
    await expect(page.locator('[data-testid="sidebar-services"]')).toHaveAttribute(
      'data-active',
      'false'
    )
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
    await expect(page.locator('[data-testid="file-source-select"]')).toHaveAttribute('data-value', 'recent')
    await expect(page.locator('[data-testid="storage-source-recent"]')).toHaveText('Recent files')
    await expect(page.locator('[data-testid="storage-source-thisMac"]')).toHaveText('This Mac')
    await expect(page.locator('[data-testid="storage-source-icloud"]')).toHaveText('iCloud')
    await expect(page.locator('[data-testid="storage-source-cloudDisk"]')).toHaveText('CloudDisk')
    await expect(page.locator('[data-testid="open-a-file"]')).toBeVisible()
    await expect(page.locator('[data-testid="file-mac-browser"]')).toHaveCount(0)
    await page.locator('[data-testid="file-source-select"]').selectOption('thisMac')
    await expect(page.locator('[data-testid="file-source-select"]')).toHaveAttribute('data-value', 'thisMac')
    await expect(page.locator('[data-testid="file-mac-browser"]')).toBeVisible()
    await expect(page.locator('[data-testid="file-mac-filter"]')).toBeVisible()
    await expect(page.locator('[data-testid="file-mac-path"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="file-mac-home"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="file-mac-parent"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="file-mac-recents"]')).toHaveCount(0)
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
    await page.evaluate((path) => {
      const api = window.__vavE2e
      if (!api) throw new Error('e2e store bridge missing')
      api.browseStorage(path)
    }, workspace)
    await expect(page.locator('[data-testid="remote-folder-entry-hello.md"]')).toBeVisible()
    await page.locator('[data-testid="remote-folder-entry-hello.md"]').dblclick()
    await expect(page.locator('[data-testid="file-preview-name"]')).toHaveText('hello.md')
    await expect(page.locator('[data-testid="applications-object-detail"]')).toBeVisible()
    await expect(page.locator('[data-testid="app-back"]')).toBeVisible()
    await page.locator('[data-testid="app-back"]').click()
    await expect(page.locator('[data-testid="file-recents"]')).toBeVisible()
    await expect(page.locator('[data-testid="file-source-select"]')).toHaveAttribute('data-value', 'thisMac')
    await expect(page.locator('[data-testid="file-mac-browser"]')).toBeVisible()
    await expect(page.locator('[data-testid="remote-folder-entry-hello.md"]')).toBeVisible()
    await page.locator('[data-testid="file-source-select"]').selectOption('recent')
    await expect(page.locator('[data-testid="file-recent-row"]')).toBeVisible()
    await page.locator('[data-testid="file-recent-row"]').dblclick()
    await expect(page.locator('[data-testid="file-preview-name"]')).toHaveText('hello.md')
    await page.locator('[data-testid="app-back"]').click()
    await expect(page.locator('[data-testid="file-recents"]')).toBeVisible()
    await expect(page.locator('[data-testid="file-source-select"]')).toHaveAttribute('data-value', 'recent')
    await expect(page.locator('[data-testid="file-recent-row"]')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})

test('Schedule lives in the app, not the session list', async () => {
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
    await expect(page.locator('[data-testid="timer-model"]')).toBeVisible()
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
    await expect(page.getByText('No notes yet')).toBeVisible()
    await expect(page.locator('[data-testid="empty-create-note"]')).toBeVisible()
    await page.locator('[data-testid="empty-create-note"]').click()
    await expect(page.locator('[data-testid="knowledge-workspace"]')).toBeVisible()
    await expect(page.locator('[data-testid="knowledge-workspace"] .file-viewer-name')).toHaveCount(0)
    await expect(page.locator('[data-testid="app-chrome"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="knowledge-ask-agent"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="app-context"]')).toHaveAttribute('data-level', 'item')
    await expect(page.locator('[data-testid="app-context"]')).toContainText('Untitled note')
    const note = page.locator('[data-testid="knowledge-note-editor"]')
    await expect(note).toBeVisible()
    await expect(note).toHaveAttribute('data-phase', 'ready')
    await expect(page.locator('[data-testid="app-back"]')).toBeVisible()
    const surface = page.locator('[data-testid="knowledge-note-input"] .ProseMirror')
    await expect(surface).toBeVisible()
    await expect(page.locator('[data-testid="knowledge-note-preview"]')).toHaveCount(0)
    await surface.click()
    await page.keyboard.press('Meta+ArrowDown')
    await page.keyboard.type('**hello**')
    await page.keyboard.press('ArrowRight')
    await expect(surface.locator('.hm-strong')).toBeVisible()
    await expect(page.locator('[data-testid="knowledge-object-excerpt"]')).toContainText('hello')
    await page.locator('[data-testid="app-back"]').click()
    await expect(page.locator('[data-testid="applications-panel"]')).toHaveAttribute('data-pane', 'list')
    await expect(page.locator('[data-testid="knowledge-object-excerpt"]')).toBeVisible()
    await expect(page.locator('[data-testid="knowledge-object-excerpt"]')).toContainText('hello')
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
