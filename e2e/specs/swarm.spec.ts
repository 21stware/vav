import { test, expect } from '@playwright/test'
import { launchVav, pressAccelerator } from '../launch'

/**
 * Swarm mode: split VAV panes, focus by click / sidebar, close, CLI surface.
 * Does not spawn vendor CLI TUIs.
 */
test('⌘D splits a Swarm thread into two panes and close restores one', async () => {
  const harness = await launchVav({ swarmMode: true })
  try {
    const { page } = harness
    await page.locator('[data-testid="app-shell"]').click()
    const originalModel = page.locator('.agent-model-picker-model .model-name')
    const modelLabel = (await originalModel.innerText()).trim()
    await page.keyboard.press('Meta+d')
    await expect(page.locator('[data-testid="swarm-split"]')).toBeVisible()
    await expect(page.locator('[data-testid="swarm-pane"]')).toHaveCount(2)

    const panes = page.locator('[data-testid="swarm-pane"]')
    await expect(panes.nth(1).locator('[data-testid="composer-input"]')).toBeFocused()
    await expect(panes.nth(1).locator('.agent-model-picker-model .model-name')).toHaveText(
      modelLabel
    )
    await panes.nth(0).click()
    await expect(panes.nth(0)).toHaveClass(/is-active/)
    await panes.nth(1).click()
    await expect(panes.nth(1)).toHaveClass(/is-active/)
    await expect(panes.nth(1).locator('[data-testid="composer-input"]')).toBeVisible()

    await panes.nth(1).locator('.terminal-split-pane-close').click()
    await expect(page.locator('[data-testid="swarm-pane"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="session-detail"]')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})

test('sidebar click focuses the matching Swarm pane', async () => {
  const harness = await launchVav({ swarmMode: true, extraSession: false })
  try {
    const { page } = harness
    await page.locator('[data-testid="app-shell"]').click()
    await page.keyboard.press('Meta+d')
    await expect(page.locator('[data-testid="swarm-pane"]')).toHaveCount(2)

    const rows = page.locator('[data-testid="session-row"]')
    await expect(rows).toHaveCount(2)
    await rows.nth(0).click()
    const firstId = await rows.nth(0).getAttribute('data-conversation-id')
    await expect(
      page.locator(`[data-testid="swarm-pane"][data-swarm-pane="${firstId}"]`)
    ).toHaveClass(/is-active/)

    await rows.nth(1).click()
    const secondId = await rows.nth(1).getAttribute('data-conversation-id')
    await expect(
      page.locator(`[data-testid="swarm-pane"][data-swarm-pane="${secondId}"]`)
    ).toHaveClass(/is-active/)
  } finally {
    await harness.dispose()
  }
})

test('⌘⇧C / ⌘⇧V flip the Swarm CLI surface and back to VAV', async () => {
  const harness = await launchVav({ swarmMode: true })
  try {
    const { page } = harness
    await pressAccelerator(harness, 'Meta+Shift+c')
    await expect(page.locator('.terminal-host-main')).not.toHaveClass(/is-surface-parked/)
    await expect(page.locator('[data-testid="cli-agent-picker"]')).toBeVisible()
    await expect(page.locator('[data-testid="cli-agent-picker"] .cli-agent-picker-item').first()).toBeVisible()

    await pressAccelerator(harness, 'Meta+Shift+v')
    // Product parks the CLI surface (display/visibility) instead of unmounting.
    await expect(page.locator('.terminal-host-main')).toHaveClass(/is-surface-parked/)
    await expect(page.locator('[data-testid="cli-agent-picker"]')).toBeHidden()
    await expect(page.locator('[data-testid="composer-input"]')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})

test('toolbar split buttons add Swarm panes', async () => {
  const harness = await launchVav({ swarmMode: true })
  try {
    const { page } = harness
    await page.locator('[data-testid="app-shell"]').click()
    await expect(page.locator('[data-testid="swarm-split-right"]')).toBeVisible()
    await expect(page.locator('[data-testid="swarm-split-down"]')).toBeVisible()
    await page.locator('[data-testid="swarm-split-right"]').click()
    await expect(page.locator('[data-testid="swarm-split"]')).toBeVisible()
    await expect(page.locator('[data-testid="swarm-pane"]')).toHaveCount(2)
  } finally {
    await harness.dispose()
  }
})

test('⌘⇧D splits Swarm panes on the other axis', async () => {
  const harness = await launchVav({ swarmMode: true })
  try {
    const { page } = harness
    await page.locator('[data-testid="app-shell"]').click()
    await page.keyboard.press('Meta+Shift+d')
    await expect(page.locator('[data-testid="swarm-split"]')).toBeVisible()
    await expect(page.locator('[data-testid="swarm-pane"]')).toHaveCount(2)
    await expect(page.locator('.terminal-split-branch')).toHaveCSS('flex-direction', 'column')
  } finally {
    await harness.dispose()
  }
})
