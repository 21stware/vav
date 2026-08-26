import { test, expect } from '@playwright/test'
import {
  chooseNativeMenu,
  dismissNativeMenu,
  launchVav,
  peekNativeMenu,
  pressAccelerator
} from '../launch'

/**
 * Product accelerators (src/shared/keyBindings.ts) plus native menus they open.
 * CLI hosts are out of scope; ⌘W / ⌘⇧O / swarm ⌘⇧C·V are skipped on purpose.
 */
test('session and chrome accelerators drive find, tools, sidebar, composer, and new session', async () => {
  const harness = await launchVav()
  try {
    const { page } = harness

    await pressAccelerator(harness, 'Meta+f')
    await expect(page.locator('[data-testid="search-strip"]')).toBeVisible()
    await page.locator('[data-testid="search-input"]').press('Escape')
    await expect(page.locator('[data-testid="search-strip"]')).toHaveCount(0)

    await pressAccelerator(harness, 'Meta+Shift+e')
    await expect(page.locator('[data-testid="tools-panel"]')).toHaveAttribute(
      'data-tools-collapsed',
      'false'
    )

    await pressAccelerator(harness, 'Meta+t')
    const term = page.locator('[data-testid="tools-panel"] [data-testid="terminal-panel"]')
    await expect(term).toBeVisible()
    await expect(term).toHaveAttribute('data-empty', 'false')

    await pressAccelerator(harness, 'Meta+Shift+h')
    await expect(page.locator('[data-testid="sidebar"]')).toHaveCount(0)
    await pressAccelerator(harness, 'Meta+Shift+h')
    await expect(page.locator('[data-testid="sidebar"]')).toBeVisible()

    await page.locator('[data-testid="sidebar-search"]').click()
    await pressAccelerator(harness, 'Meta+k')
    await expect(page.locator('[data-testid="composer-input"]')).toBeFocused()

    await pressAccelerator(harness, 'Meta+n')
    await expect(page.getByText('New session')).toBeVisible()
    await expect(page.getByText('E2E session')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})

test('⌘, opens Settings and ⌘⇧P opens the native approval menu', async () => {
  const harness = await launchVav()
  try {
    const { page } = harness

    const opened = harness.app.waitForEvent('window')
    await pressAccelerator(harness, 'Meta+,')
    const settings = await opened
    await expect(settings.locator('[data-testid="settings-window"]')).toBeVisible()
    await expect(settings.locator('[data-testid="settings-nav-appearance"]')).toHaveClass(/selected/)
    await expect(settings.locator('.settings-head')).toHaveText('Appearance')
    await settings.evaluate(() => window.vav.window.closeSettings())

    await page.bringToFront()
    await expect(page.locator('[data-testid="approval-mode"]')).toContainText('Auto')
    await pressAccelerator(harness, 'Meta+Shift+p')
    await expect
      .poll(async () => {
        const items = await peekNativeMenu(page)
        return items?.map((item) => item.label) ?? []
      })
      .toEqual(expect.arrayContaining(['Auto', 'Bypass', 'Edit']))
    await chooseNativeMenu(page, 'Edit')
    await expect(page.locator('[data-testid="approval-mode"]')).toContainText('Edit')

    await page.locator('[data-testid="thinking-level"]').click()
    await expect
      .poll(async () => {
        const items = await peekNativeMenu(page)
        return items?.map((item) => item.label) ?? []
      })
      .toEqual(expect.arrayContaining(['Thinking level', 'Off', 'Low', 'Medium', 'High', 'Max']))
    await dismissNativeMenu(page)
  } finally {
    await harness.dispose()
  }
})

test('⌘F / ⌘G walk transcript matches', async () => {
  const harness = await launchVav({ seedConversation: 'agent' })
  try {
    const { page } = harness
    await pressAccelerator(harness, 'Meta+f')
    await expect(page.locator('[data-testid="search-strip"]')).toBeVisible()
    await page.locator('[data-testid="search-input"]').fill('e2e')
    await expect(page.locator('[data-testid="search-count"]')).toHaveText(/^1 \/ \d+$/)
    const first = await page.locator('[data-testid="search-count"]').innerText()
    expect(Number(first.split('/')[1])).toBeGreaterThan(1)

    await pressAccelerator(harness, 'Meta+g')
    await expect(page.locator('[data-testid="search-count"]')).not.toHaveText(first)
    await expect(page.locator('[data-testid="search-count"]')).toHaveText(/^\d+ \/ \d+$/)
  } finally {
    await harness.dispose()
  }
})
