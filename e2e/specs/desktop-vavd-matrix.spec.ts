import { test, expect } from '@playwright/test'
import { E2E_SESSION_ID } from '../seedConversation'
import {
  ensureSelectedSession,
  launchVav,
  openFilesTray,
  readElectronConversation,
  readVavdConversation,
  seedVavKeyAccount,
  sessionRow
} from '../launch'

/**
 * Desktop UI over the spawned local vavd — the production path.
 * Covers every named product-matrix branch on the workbench itself
 * (list / send / workspace / files / git / plugins / terminal / configure).
 */
test('spawned vavd desktop covers list, send, files, and terminal', async () => {
  test.setTimeout(90_000)
  const harness = await launchVav({ spawnVavd: true, stubTurn: true, seedGit: true })
  try {
    const { page } = harness
    await expect
      .poll(async () => {
        const hosts = await page.evaluate(() => window.vav.hosts.list())
        return hosts.some((host) => host.localShell && host.controlPlane === true && host.online)
      })
      .toBe(true)
    await expect(page.locator('[data-testid="sidebar-connect"]')).toHaveAttribute(
      'data-machine-id',
      'local'
    )

    await seedVavKeyAccount(page)
    await ensureSelectedSession(page)
    const before = await page.locator('[data-testid="session-row"]').count()
    await page.locator('[data-testid="new-session"]').click()
    await expect(page.locator('[data-testid="session-row"]')).toHaveCount(before + 1)
    await expect(page.locator('[data-testid="session-row"].selected')).toBeVisible()

    await sessionRow(page, E2E_SESSION_ID).click()
    await expect(sessionRow(page, E2E_SESSION_ID)).toHaveClass(/selected/)
    const sessionId = E2E_SESSION_ID

    await page.evaluate((id) => window.vav.conversations.setApprovalMode(id, 'edit'), sessionId)
    await expect
      .poll(async () => {
        const conversation = await page.evaluate((id) => window.vav.conversations.get(id), sessionId)
        return conversation?.approvalMode ?? null
      })
      .toBe('edit')

    await page.locator('[data-testid="composer-input"]').fill('hello from spawned desktop vavd')
    await page.locator('[data-testid="composer-send"]').click()
    await expect(page.getByText('e2e stub reply')).toBeVisible({ timeout: 20_000 })
    await expect
      .poll(() => readVavdConversation(harness.userData, sessionId)?.includes('e2e stub reply') ?? false)
      .toBe(true)
    expect(readElectronConversation(harness.userData, sessionId) ?? '').not.toContain('e2e stub reply')

    await openFilesTray(page)
    await expect(page.locator('[data-testid="files-panel"]')).toBeVisible()
    await expect(page.locator('[data-file-path$="hello.md"]')).toBeVisible()
    await page.locator('[data-file-path$="hello.md"]').dblclick()
    await expect(page.locator('[data-testid="file-preview"]')).not.toHaveClass(/is-collapsed/)
    await expect(page.locator('[data-testid="file-preview-name"]')).toHaveText('hello.md')
    await expect(page.getByText('hello from e2e')).toBeVisible()

    await page.locator('[data-testid="files-new-file"]').click()
    const name = page.locator('[data-testid="files-create-name"]')
    await expect(name).toBeVisible()
    await name.pressSequentially('note.md')
    await name.press('Enter')
    await expect(page.locator('[data-file-path$="note.md"]')).toBeVisible()

    const gitSnap = await page.evaluate((cwd) => window.vav.git.status(cwd), harness.workspace)
    expect(gitSnap.isRepo).toBe(true)
    await page.locator('[data-testid="segment-git"]').click()
    await expect(page.locator('[data-testid="git-panel"]')).toBeVisible()
    await expect(page.locator('.git-change-path')).toContainText('hello.md')
    await page.locator('[data-testid="segment-plugins"]').click()
    await expect(page.locator('[data-testid="plugins-tray"]')).toBeVisible()
    await page.locator('[data-testid="segment-files"]').click()
    await expect(page.locator('[data-testid="files-panel"]')).toBeVisible()

    const tools = page.locator('[data-testid="tools-panel"]')
    if ((await tools.getAttribute('data-tools-collapsed')) === 'true') {
      await page.locator('[data-testid="tools-toggle"]').click()
    }
    await page.locator('[data-testid="new-bash"]').click()
    await expect(page.locator('[data-testid="tools-panel"] [data-testid="terminal-panel"]')).toBeVisible({
      timeout: 20_000
    })
    await expect
      .poll(async () => {
        const listed = await page.evaluate((id) => window.vav.pty.list(id), sessionId)
        return listed.sessions.length
      })
      .toBeGreaterThan(0)
  } finally {
    await harness.dispose()
  }
})
