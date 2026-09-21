import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import {
  E2E_SESSION_ID,
  launchWorkbench,
  readVavServerConversation,
  seedVavKeyAccount
} from '../launch'

/**
 * App column + independent workspace agent:
 * file canvases pick blocks, data canvases pick cells, and both stay on the
 * middle agent when the right-hand app switches.
 */
test('file block pick stays on the workspace agent across app switches', async () => {
  const harness = await launchWorkbench()
  try {
    const { page, workspace } = harness
    await expect(page.locator('[data-testid="app-column"]')).toBeVisible()
    await expect(page.locator('[data-testid="agent-column"]')).toBeVisible()
    await expect(page.locator('[data-testid="app-chrome"]')).toBeVisible()

    await page.locator('[data-testid="applications-tab-storage"]').click()
    await page.locator('[data-testid="file-source-select"]').selectOption('thisMac')
    await page.locator('[data-testid="file-mac-path"]').fill(workspace)
    await page.locator('[data-testid="file-mac-path"]').press('Enter')
    await page.locator('[data-testid="remote-folder-entry-hello.md"]').dblclick()
    await expect(page.locator('[data-testid="file-preview-name"]')).toHaveText('hello.md')

    const detail = page.locator('[data-testid="applications-object-detail"]')
    await expect(detail.locator('.preview-select-region, [data-block-id]').first()).toBeVisible()
    await detail.locator('.preview-select-region, [data-block-id]').first().click()
    await expect
      .poll(async () => detail.locator('.preview-select-region.selected, .selected[data-block-id]').count())
      .toBeGreaterThan(0)

    const agentCard = page.locator('[data-testid="agent-column"] .comment-card').first()
    await expect(agentCard).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('[data-testid="agent-column"] .comment-card-title').first()).toContainText(
      /hello|heading|line/i
    )
    await expect(
      page.locator(`[data-testid="session-row"][data-conversation-id="${E2E_SESSION_ID}"]`)
    ).toBeVisible()

    await expect
      .poll(async () => {
        const peek = await page.evaluate(() => window.__vavE2e?.peekContext() ?? null)
        return (
          peek?.activeId === E2E_SESSION_ID && (peek.focusedFilePath?.endsWith('hello.md') ?? false)
        )
      })
      .toBe(true)

    await page.locator('[data-testid="applications-tab-data"]').click()
    await expect(page.locator('[data-testid="data-home"]')).toBeVisible()
    await expect(page.locator('[data-testid="app-chrome"]')).toBeVisible()
    await expect(page.locator('[data-testid="close-app"]')).toBeVisible()
    await expect(agentCard).toBeVisible()
    await expect(page.locator('[data-testid="composer-input"]')).toBeVisible()
    await expect
      .poll(async () => {
        const peek = await page.evaluate(() => window.__vavE2e?.peekContext() ?? null)
        return peek?.activeId === E2E_SESSION_ID && (peek.commentCards?.length ?? 0) > 0
      })
      .toBe(true)

    await page.locator('[data-testid="applications-tab-knowledge"]').click()
    await expect(page.getByText('No knowledge yet')).toBeVisible()
    await expect(page.locator('[data-testid="app-chrome"]')).toBeVisible()
    await expect(agentCard).toBeVisible()
    await expect(page.locator('[data-testid="session-row"]').getByText('E2E session')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})

test('data cell pick stays on the workspace agent and is sent as context', async () => {
  const harness = await launchWorkbench({ stubTurn: true })
  try {
    const { page, workspace, userData } = harness
    await seedVavKeyAccount(page)
    await page.evaluate(async (path) => {
      const api = window.__vavE2e
      if (!api) throw new Error('e2e store bridge missing')
      await api.createDataFromFile(path)
    }, join(workspace, 'notes.db'))

    await page.locator('[data-testid="applications-tab-data"]').click()
    await expect(page.locator('[data-testid="data-object-row"]')).toBeVisible()
    if ((await page.locator('[data-testid="data-file-workspace"]').count()) === 0) {
      await page.locator('[data-testid="data-object-row"]').click()
    }
    await expect(page.locator('[data-testid="data-file-workspace"]')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Pens')).toBeVisible({ timeout: 20_000 })

    const cell = page.locator('[data-testid="applications-object-detail"] td[data-block-id]').first()
    await expect(cell).toBeVisible()
    await cell.click()
    await expect
      .poll(async () =>
        page.locator('[data-testid="applications-object-detail"] td[data-block-id].selected').count()
      )
      .toBeGreaterThan(0)

    const agentCard = page.locator('[data-testid="agent-column"] .comment-card').first()
    await expect(agentCard).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('[data-testid="agent-column"] .comment-card-title').first()).toContainText(
      /pens|items|cell|qty/i
    )

    await expect
      .poll(async () => {
        const peek = await page.evaluate(() => window.__vavE2e?.peekContext() ?? null)
        return (
          peek?.activeId === E2E_SESSION_ID && (peek.focusedFilePath?.endsWith('notes.db') ?? false)
        )
      })
      .toBe(true)

    await page.locator('[data-testid="applications-tab-storage"]').click()
    await expect(page.locator('[data-testid="file-recents"]')).toBeVisible()
    await expect(page.locator('[data-testid="app-chrome"]')).toBeVisible()
    await expect(agentCard).toBeVisible()

    await page.locator('[data-testid="composer-input"]').fill('what is this cell')
    await page.locator('[data-testid="composer-send"]').click()
    await expect(page.locator('[data-testid="message-user"]')).toContainText('what is this cell')
    await expect(page.locator('[data-testid="message-assistant"]')).toContainText('e2e stub reply')

    await expect
      .poll(() => {
        const raw = readVavServerConversation(userData, E2E_SESSION_ID)
        if (!raw) return 0
        const conv = JSON.parse(raw) as {
          messages?: Array<{ role?: string; contextBlocks?: unknown[] }>
        }
        return (
          conv.messages?.find((message) => message.role === 'user' && message.contextBlocks?.length)
            ?.contextBlocks?.length ?? 0
        )
      })
      .toBeGreaterThan(0)
  } finally {
    await harness.dispose()
  }
})

test('app chrome stays consistent while switching Storage / Data / Knowledge', async () => {
  const harness = await launchWorkbench()
  try {
    const { page } = harness
    const modes = [
      { tab: 'applications-tab-storage', app: 'storage' },
      { tab: 'applications-tab-data', app: 'data' },
      { tab: 'applications-tab-knowledge', app: 'knowledge' }
    ] as const
    for (const mode of modes) {
      await page.locator(`[data-testid="${mode.tab}"]`).click()
      await expect(page.locator(`[data-testid="${mode.tab}"]`)).toHaveAttribute('data-active', 'true')
      const panel = page.locator('[data-testid="applications-panel"]')
      await expect(panel).toHaveAttribute('data-app', mode.app)
      await expect(page.locator('[data-testid="app-chrome"]')).toBeVisible()
      await expect(page.locator('[data-testid="app-chrome"] .app-chrome-title')).toBeVisible()
      await expect(page.locator('[data-testid="close-app"]')).toBeVisible()
      await expect(page.locator('[data-testid="agent-column"]')).toBeVisible()
      await expect(page.locator('[data-testid="composer-input"]')).toBeVisible()
      await expect(page.locator('[data-testid="session-row"]').getByText('E2E session')).toBeVisible()
    }
  } finally {
    await harness.dispose()
  }
})
