import { test, expect } from '@playwright/test'
import { launchVav } from '../launch'

/**
 * session/main-chat.rpml + main-chat-search.rpml + terminal-panel.rpml
 * + companions/token-usage.rpml — session chrome only, no CLI hosts.
 */
test('tools tray expands, New bash opens a user PTY, and collapse works', async () => {
  const harness = await launchVav()
  try {
    const { page } = harness
    await expect(page.locator('[data-testid="tools-panel"]')).toHaveAttribute(
      'data-tools-collapsed',
      'true'
    )
    await page.locator('[data-testid="tools-toggle"]').click()
    await expect(page.locator('[data-testid="tools-panel"]')).toHaveAttribute(
      'data-tools-collapsed',
      'false'
    )

    await page.locator('[data-testid="new-bash"]').click()
    const term = page.locator('[data-testid="tools-panel"] [data-testid="terminal-panel"]')
    await expect(term).toBeVisible()
    await expect(term).toHaveAttribute('data-empty', 'false')

    await page.locator('[data-testid="tools-toggle"]').click()
    await expect(page.locator('[data-testid="tools-panel"]')).toHaveAttribute(
      'data-tools-collapsed',
      'true'
    )
  } finally {
    await harness.dispose()
  }
})

test('transcript search strip finds no matches then closes', async () => {
  const harness = await launchVav()
  try {
    const { page } = harness
    await page.locator('[data-testid="session-search"]').click()
    await expect(page.locator('[data-testid="search-strip"]')).toBeVisible()
    await page.locator('[data-testid="search-input"]').fill('zzz-no-match')
    await expect(page.getByText('No matches')).toBeVisible()
    await page.locator('[data-testid="search-input"]').press('Escape')
    await expect(page.locator('[data-testid="search-strip"]')).toHaveCount(0)
  } finally {
    await harness.dispose()
  }
})

test('composer exposes attach and screenshot actions', async () => {
  const harness = await launchVav()
  try {
    const { page } = harness
    await expect(page.locator('[data-testid="composer-attach"]')).toBeVisible()
    await expect(page.locator('[data-testid="composer-screenshot"]')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})

test('composer token ring opens the Context window popup', async () => {
  const harness = await launchVav()
  try {
    const ring = harness.page.locator('[data-testid="token-ring"]')
    await expect(ring).toBeVisible()
    const opened = harness.app.waitForEvent('window')
    await ring.click()
    const usage = await opened
    await expect(usage.locator('[data-testid="token-usage-window"]')).toBeVisible()
    await expect(usage.getByText('Context window')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})
