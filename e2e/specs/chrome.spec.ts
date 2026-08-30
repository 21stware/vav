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

test('New bash sits after tabs and pins right when the tab strip overflows', async () => {
  const harness = await launchVav()
  try {
    const { app, page } = harness
    const header = page.locator('.tools-header')
    const neu = page.locator('[data-testid="new-bash"]')

    await expect(header).toHaveAttribute('data-new-edge', 'start')
    const idleGap = await neu.evaluate((el) => {
      const path = document.querySelector('[data-testid="workdir-chip"]')
      if (!path) return -1
      return el.getBoundingClientRect().left - path.getBoundingClientRect().right
    })
    expect(idleGap).toBeGreaterThanOrEqual(0)
    expect(idleGap).toBeLessThan(28)

    await neu.click()
    await neu.click()
    await neu.click()
    await expect(page.locator('[data-testid="tools-panel"] [data-testid="terminal-panel"]')).toBeVisible()

    const afterTabsGap = await neu.evaluate((el) => {
      const chips = document.querySelectorAll('.tools-header-tabs .chip')
      const last = chips[chips.length - 1]
      if (!last) return -1
      return el.getBoundingClientRect().left - last.getBoundingClientRect().right
    })
    expect(afterTabsGap).toBeGreaterThanOrEqual(0)
    expect(afterTabsGap).toBeLessThan(28)

    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      win?.setSize(400, 820)
    })
    await expect(header).toHaveAttribute('data-new-edge', 'end')

    const endGap = await neu.evaluate((el) => {
      const trail = document.querySelector('.tools-header-trail')
      if (!trail) return -1
      return trail.getBoundingClientRect().left - el.getBoundingClientRect().right
    })
    expect(endGap).toBeGreaterThanOrEqual(0)
    expect(endGap).toBeLessThan(28)
  } finally {
    await harness.dispose()
  }
})

test('tools fullscreen expands the tray to 70% height', async () => {
  const harness = await launchVav()
  try {
    const { page } = harness
    const panel = page.locator('[data-testid="tools-panel"]')
    await expect(panel).toHaveAttribute('data-tools-collapsed', 'true')

    await page.locator('[data-testid="tools-fullscreen"]').click()
    await expect(panel).toHaveAttribute('data-tools-collapsed', 'false')
    await expect(panel).toHaveAttribute('data-tools-snapped', 'true')

    const ratio = await page.evaluate(() => {
      const well = document.querySelector('.tools-body-well')
      const column = well?.closest('main')
      if (!well || !column) return 0
      return well.getBoundingClientRect().height / column.getBoundingClientRect().height
    })
    expect(ratio).toBeGreaterThan(0.64)
    expect(ratio).toBeLessThan(0.76)
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
  // The ring lives on the agent model picker; once the thread has messages
  // the picker locks and clicking the host button opens the usage popup.
  const harness = await launchVav({ liveAcp: true, acpUsage: true })
  try {
    const { app, page } = harness
    await page.locator('[data-testid="composer-input"]').fill('ring probe')
    await page.locator('[data-testid="composer-send"]').click()
    await expect(page.locator('[data-testid="message-assistant"]')).toContainText(
      'e2e acp reply',
      { timeout: 20_000 }
    )
    await expect(page.locator('.agent-model-picker-progress')).toBeVisible()

    const opened = app.waitForEvent('window')
    await page.locator('.agent-model-picker-host').click()
    const usage = await opened
    await expect(usage.locator('[data-testid="token-usage-window"]')).toBeVisible()
    await expect(usage.getByText('Context window')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})
