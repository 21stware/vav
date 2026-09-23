import { join } from 'node:path'
import { test, expect } from '@playwright/test'
import {
  E2E_SESSION_ID,
  launchWorkbench,
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
    await expect(page.locator('[data-testid="app-mode-tabs"]')).toBeVisible()
    await expect(page.locator('[data-testid="close-app"]')).toBeVisible()
    await expect(page.locator('[data-testid="app-chrome"]')).toHaveCount(0)

    await page.locator('[data-testid="applications-tab-storage"]').click()
    await page.locator('[data-testid="file-source-select"]').selectOption('thisMac')
    await page.evaluate((path) => {
      const api = window.__vavE2e
      if (!api) throw new Error('e2e store bridge missing')
      api.browseStorage(path)
    }, workspace)
    await page.locator('[data-testid="remote-folder-entry-hello.md"]').dblclick()
    await expect(page.locator('[data-testid="file-preview-name"]')).toHaveText('hello.md')
    await expect(page.locator('[data-testid="app-context"]')).toHaveAttribute('data-level', 'item')
    await expect(page.locator('[data-testid="app-context"]')).toContainText('hello.md')

    const detail = page.locator('[data-testid="applications-object-detail"]')
    await expect(detail.locator('.preview-select-region, [data-block-id]').first()).toBeVisible()
    await detail.locator('.preview-select-region, [data-block-id]').first().click()
    await expect
      .poll(async () => detail.locator('.preview-select-region.selected, .selected[data-block-id]').count())
      .toBeGreaterThan(0)

    const agentCard = page.locator('[data-testid="agent-column"] .comment-card').first()
    await expect(agentCard).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('[data-testid="app-context"]')).toHaveAttribute('data-level', 'selected')
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
          peek?.activeId === E2E_SESSION_ID &&
          (peek.focusedFilePath?.endsWith('hello.md') ?? false) &&
          peek.appColumnFocus?.kind === 'storage' &&
          // A picked block puts the file focus at 'selected' (same as the data
          // cell flow below); the pick also rides as a comment card.
          peek.appColumnFocus.level === 'selected' &&
          (peek.appColumnFocus.path?.endsWith('hello.md') ?? false)
        )
      })
      .toBe(true)

    await page.locator('[data-testid="applications-tab-data"]').click()
    await expect(page.locator('[data-testid="data-home"]')).toBeVisible()
    await expect(page.locator('[data-testid="app-mode-tabs"]')).toBeVisible()
    await expect(page.locator('[data-testid="close-app"]')).toBeVisible()
    await expect(page.locator('[data-testid="app-chrome"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="app-context"]')).toHaveAttribute('data-level', 'list')
    await expect(page.locator('[data-testid="agent-column"] .comment-card')).toHaveCount(0)
    await expect(page.locator('[data-testid="composer-input"]')).toBeVisible()
    await expect
      .poll(async () => {
        const peek = await page.evaluate(() => window.__vavE2e?.peekContext() ?? null)
        return (
          peek?.activeId === E2E_SESSION_ID &&
          peek?.appContextLevel === 'list' &&
          peek.appColumnFocus?.kind === 'data' &&
          peek.appColumnFocus.level === 'list'
        )
      })
      .toBe(true)

    await page.locator('[data-testid="applications-tab-knowledge"]').click()
    await expect(page.getByText('No notes yet')).toBeVisible()
    await expect(page.locator('[data-testid="app-mode-tabs"]')).toBeVisible()
    await expect(page.locator('[data-testid="app-chrome"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="app-context"]')).toHaveAttribute('data-level', 'list')
    await expect(page.locator('[data-testid="session-row"]').getByText('E2E session')).toBeVisible()

    await page.locator('[data-testid="close-app"]').click()
    await expect(page.locator('[data-testid="app-context"]')).toHaveCount(0)
  } finally {
    await harness.dispose()
  }
})

test('data cell pick stays on the workspace agent and is sent as context', async () => {
  const harness = await launchWorkbench({ stubTurn: true })
  try {
    const { page, workspace } = harness
    await seedVavKeyAccount(page)
    await page.evaluate(async (path) => {
      const api = window.__vavE2e
      if (!api) throw new Error('e2e store bridge missing')
      await api.createDataFromFile(path)
    }, join(workspace, 'notes.db'))

    await page.locator('[data-testid="applications-tab-data"]').click()
    if ((await page.locator('[data-testid="data-file-workspace"]').count()) === 0) {
      const notesRow = page.locator('[data-testid="data-object-row"]').filter({ hasText: 'notes.db' })
      await expect(notesRow).toBeVisible()
      await notesRow.dblclick()
    }
    await expect(page.locator('[data-testid="data-file-workspace"]')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('cell', { name: 'Pens' })).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('[data-testid="app-context"]')).toHaveAttribute('data-level', 'item')

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
    await expect(page.locator('[data-testid="app-context"]')).toHaveAttribute('data-level', 'selected')
    await expect(page.locator('[data-testid="agent-column"] .comment-card-title').first()).toContainText(
      /pens|items|cell|qty/i
    )

    await expect
      .poll(async () => {
        const peek = await page.evaluate(() => window.__vavE2e?.peekContext() ?? null)
        return (
          peek?.activeId === E2E_SESSION_ID &&
          (peek.focusedFilePath?.endsWith('notes.db') ?? false) &&
          peek.appColumnFocus?.kind === 'data' &&
          peek.appColumnFocus.level === 'selected' &&
          (peek.appColumnFocus.path?.endsWith('notes.db') ?? false)
        )
      })
      .toBe(true)

    await page.locator('[data-testid="applications-tab-storage"]').click()
    await expect(page.locator('[data-testid="file-recents"]')).toBeVisible()
    await expect(page.locator('[data-testid="app-mode-tabs"]')).toBeVisible()
    await expect(page.locator('[data-testid="app-chrome"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="app-context"]')).toHaveAttribute('data-level', 'list')
    await expect(page.locator('[data-testid="agent-column"] .comment-card')).toHaveCount(0)
    await expect
      .poll(async () => {
        const peek = await page.evaluate(() => window.__vavE2e?.peekContext() ?? null)
        return peek?.activeId === E2E_SESSION_ID && peek?.appContextLevel === 'list'
      })
      .toBe(true)

    await page.locator('[data-testid="composer-input"]').fill('what is this cell')
    await page.locator('[data-testid="composer-send"]').click()
    await expect(page.locator('[data-testid="message-user"]')).toContainText('what is this cell')
    await expect(page.locator('[data-testid="message-assistant"]')).toContainText('e2e stub reply')
    await expect(
      page.locator(`[data-testid="session-row"][data-conversation-id="${E2E_SESSION_ID}"]`)
    ).toBeVisible()
  } finally {
    await harness.dispose()
  }
})

test('openInApp and insertAgentPrompt stay on the workspace agent', async () => {
  const harness = await launchWorkbench()
  try {
    const { page, workspace } = harness
    const filePath = join(workspace, 'hello.md')

    await page.evaluate(async (path) => {
      const api = window.__vavE2e
      if (!api) throw new Error('e2e store bridge missing')
      await api.openInApp(path)
    }, filePath)

    await expect(page.locator('[data-testid="file-preview-name"]')).toHaveText('hello.md')
    await expect(page.locator('[data-testid="applications-panel"]')).toHaveAttribute('data-app', 'storage')
    await expect(page.locator('[data-testid="applications-object-detail"]')).toBeVisible()
    await expect(
      page.locator(`[data-testid="session-row"][data-conversation-id="${E2E_SESSION_ID}"]`)
    ).toBeVisible()
    await expect
      .poll(async () => {
        const peek = await page.evaluate(() => window.__vavE2e?.peekContext() ?? null)
        return (
          peek?.activeId === E2E_SESSION_ID &&
          ((peek.focusedFilePath?.endsWith('hello.md') ?? false) ||
            (peek.contextFile?.endsWith('hello.md') ?? false))
        )
      })
      .toBe(true)

    await page.evaluate(async (path) => {
      const api = window.__vavE2e
      if (!api) throw new Error('e2e store bridge missing')
      await api.openInApp(path)
    }, workspace)

    await expect
      .poll(async () => {
        const peek = await page.evaluate(() => window.__vavE2e?.peekContext() ?? null)
        return peek?.activeId === E2E_SESSION_ID && peek?.storageBrowsePath === workspace
      })
      .toBe(true)
    await expect(page.locator('[data-testid="remote-folder-entry-hello.md"]')).toBeVisible()
    await expect(page.locator('[data-testid="session-row"]').getByText('E2E session')).toBeVisible()

    const prompt = 'search Storage for hello.md headings'
    await page.evaluate((text) => {
      const api = window.__vavE2e
      if (!api) throw new Error('e2e store bridge missing')
      api.insertAgentPrompt(text)
    }, prompt)

    await expect
      .poll(async () => {
        const peek = await page.evaluate(() => window.__vavE2e?.peekContext() ?? null)
        return peek?.activeId === E2E_SESSION_ID && peek.draft.includes(prompt)
      })
      .toBe(true)
    await expect(page.locator('[data-testid="composer-input"]')).toHaveValue(prompt)
  } finally {
    await harness.dispose()
  }
})

test('Notes and Analysis lists select on click and enter on double-click', async () => {
  const harness = await launchWorkbench()
  try {
    const { page, workspace } = harness
    await page.evaluate(async (path) => {
      const api = window.__vavE2e
      if (!api) throw new Error('e2e store bridge missing')
      await api.createDataFromFile(path)
    }, join(workspace, 'notes.db'))
    await page.evaluate(async () => {
      const api = window.__vavE2e
      if (!api) throw new Error('e2e store bridge missing')
      await api.createKnowledgeNote()
    })

    await page.locator('[data-testid="applications-tab-data"]').click()
    const dataRow = page.locator('[data-testid="data-object-row"]').filter({ hasText: 'notes.db' })
    await expect(dataRow).toBeVisible()
    await dataRow.click()
    await expect(dataRow).toHaveAttribute('data-active', 'true')
    await expect(page.locator('[data-testid="applications-panel"]')).toHaveAttribute('data-pane', 'list')
    await expect(page.locator('[data-testid="data-file-workspace"]')).toHaveCount(0)
    await dataRow.dblclick()
    await expect(page.locator('[data-testid="data-file-workspace"]')).toBeVisible()

    await page.locator('[data-testid="applications-tab-knowledge"]').click()
    const noteRow = page.locator('[data-testid="knowledge-object-row"]').first()
    await expect(noteRow).toBeVisible()
    await noteRow.click()
    await expect(noteRow).toHaveAttribute('data-active', 'true')
    await expect(page.locator('[data-testid="applications-panel"]')).toHaveAttribute('data-pane', 'list')
    await expect(page.locator('[data-testid="knowledge-workspace"]')).toHaveCount(0)
    await noteRow.dblclick()
    await expect(page.locator('[data-testid="knowledge-workspace"]')).toBeVisible()
    await expect
      .poll(async () => {
        const peek = await page.evaluate(() => window.__vavE2e?.peekContext() ?? null)
        return peek?.applicationsDetailOpen === true && peek.activeId === E2E_SESSION_ID
      })
      .toBe(true)
  } finally {
    await harness.dispose()
  }
})

test('app tabs stay consistent while switching Storage / Data / Knowledge', async () => {
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
      await expect(page.locator('[data-testid="app-mode-tabs"]')).toBeVisible()
      await expect(page.locator('[data-testid="app-chrome"]')).toHaveCount(0)
      await expect(page.locator('[data-testid="close-app"]')).toBeVisible()
      await expect(page.locator('[data-testid="app-context"]')).toHaveAttribute('data-level', 'list')
      await expect(page.locator('[data-testid="app-context"]')).toHaveAttribute('data-kind', mode.app)
      await expect(page.locator('[data-testid="agent-column"]')).toBeVisible()
      await expect(page.locator('[data-testid="composer-input"]')).toBeVisible()
      await expect(page.locator('[data-testid="session-row"]').getByText('E2E session')).toBeVisible()
    }
    await page.locator('[data-testid="close-app"]').click()
    await expect(page.locator('[data-testid="app-context"]')).toHaveCount(0)
  } finally {
    await harness.dispose()
  }
})
