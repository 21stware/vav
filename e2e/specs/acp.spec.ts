import { test, expect } from '@playwright/test'
import { chooseNativeMenu, dismissNativeMenu, E2E_SESSION_ID, launchVav, peekNativeMenu } from '../launch'

/**
 * ACP session chrome on the composer — slash commands and session modes.
 * No ACP stdio host is spawned. Native AppKit is intercepted under VAV_E2E.
 */
test('ACP slash menu lists seeded commands and inserts one', async () => {
  const harness = await launchVav({ seedConversation: 'acp' })
  try {
    const { page } = harness
    const input = page.locator('[data-testid="composer-input"]')
    await input.fill('/')
    const menu = page.locator('[data-testid="acp-slash-menu"]')
    await expect(menu).toBeVisible()
    await expect(page.locator('[data-testid="acp-slash-compact"]')).toBeVisible()
    await expect(page.locator('[data-testid="acp-slash-cost"]')).toBeVisible()
    await page.locator('[data-testid="acp-slash-compact"]').click()
    await expect(input).toHaveValue('/compact ')
    await expect(page.locator('[data-testid="acp-slash-compact"]')).toHaveCount(0)
  } finally {
    await harness.dispose()
  }
})

test('ACP slash menu filters as the draft grows', async () => {
  const harness = await launchVav({ seedConversation: 'acp' })
  try {
    const { page } = harness
    await page.locator('[data-testid="composer-input"]').fill('/comp')
    await expect(page.locator('[data-testid="acp-slash-compact"]')).toBeVisible()
    await expect(page.locator('[data-testid="acp-slash-cost"]')).toHaveCount(0)
  } finally {
    await harness.dispose()
  }
})

test('ACP slash menu has no rows for an unknown command', async () => {
  const harness = await launchVav({ seedConversation: 'acp' })
  try {
    const { page } = harness
    await page.locator('[data-testid="composer-input"]').fill('/zzz-unknown')
    await expect(page.locator('[data-testid="acp-slash-menu"]')).toHaveCount(0)
  } finally {
    await harness.dispose()
  }
})

test('ACP slash keyboard highlights, inserts, and Escape dismisses', async () => {
  const harness = await launchVav({ seedConversation: 'acp' })
  try {
    const { page } = harness
    const input = page.locator('[data-testid="composer-input"]')
    await input.fill('/')
    await expect(page.locator('[data-testid="acp-slash-compact"]')).toHaveAttribute(
      'data-active',
      'true'
    )
    await input.press('ArrowDown')
    await expect(page.locator('[data-testid="acp-slash-cost"]')).toHaveAttribute(
      'data-active',
      'true'
    )
    await input.press('Enter')
    await expect(input).toHaveValue('/cost ')
    await expect(page.locator('[data-testid="acp-slash-menu"]')).toHaveCount(0)

    await input.fill('/')
    await expect(page.locator('[data-testid="acp-slash-menu"]')).toBeVisible()
    await input.press('Escape')
    await expect(page.locator('[data-testid="acp-slash-menu"]')).toHaveCount(0)
    await expect(input).toHaveValue('/')
  } finally {
    await harness.dispose()
  }
})

test('ACP session mode chip shows the current mode', async () => {
  const harness = await launchVav({ seedConversation: 'acp' })
  try {
    const mode = harness.page.locator('[data-testid="session-run-controls"]')
    await expect(mode).toBeVisible()
    await expect(mode).toHaveAttribute('data-session-mode', 'agent')
  } finally {
    await harness.dispose()
  }
})

test('ACP session mode native menu switches to Plan and persists', async () => {
  const harness = await launchVav({ seedConversation: 'acp' })
  try {
    const { page } = harness
    const mode = page.locator('[data-testid="session-run-controls"]')
    await expect(mode).toHaveAttribute('data-session-mode', 'agent')

    await page.locator('[data-testid="session-run-mode"]').click()
    await expect
      .poll(async () => {
        const items = await peekNativeMenu(page)
        return items?.map((item) => item.label) ?? []
      })
      .toEqual(expect.arrayContaining(['Agent', 'Plan']))
    const items = await peekNativeMenu(page)
    expect(items?.find((item) => item.label === 'Agent')?.checked).toBe(true)

    await chooseNativeMenu(page, 'Plan')
    await expect(mode).toHaveAttribute('data-session-mode', 'plan')

    await expect
      .poll(async () => {
        const conversation = await page.evaluate(
          (id) => window.vav.conversations.get(id),
          E2E_SESSION_ID
        )
        return conversation?.acpSession?.currentModeId ?? null
      })
      .toBe('plan')
  } finally {
    await harness.dispose()
  }
})

test('ACP session mode native menu can be dismissed without changing mode', async () => {
  const harness = await launchVav({ seedConversation: 'acp' })
  try {
    const { page } = harness
    const mode = page.locator('[data-testid="session-run-controls"]')
    await page.locator('[data-testid="session-run-mode"]').click()
    await expect.poll(async () => (await peekNativeMenu(page))?.length ?? 0).toBeGreaterThan(0)
    await dismissNativeMenu(page)
    await expect.poll(async () => peekNativeMenu(page)).toBeNull()
    await expect(mode).toHaveAttribute('data-session-mode', 'agent')
  } finally {
    await harness.dispose()
  }
})
