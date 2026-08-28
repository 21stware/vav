import { test, expect } from '@playwright/test'
import {
  E2E_SESSION_B_ID,
  E2E_SESSION_ID,
  launchVav,
  seedApiKey,
  sessionRow
} from '../launch'

/**
 * Unseen complete: sidebar Done badge + conversation.resultUnseen.
 * Dock badge text is driven by native app.dock.setBadge.
 */
test('background stub complete marks the other session unseen', async () => {
  const harness = await launchVav({ stubTurn: true, extraSession: true })
  try {
    const { page } = harness
    await seedApiKey(page)
    await sessionRow(page, E2E_SESSION_B_ID).click()
    await expect(sessionRow(page, E2E_SESSION_B_ID)).toHaveClass(/selected/)

    await page.evaluate(
      (id) => window.vav.agent.send(id, 'ping e2e', []),
      E2E_SESSION_ID
    )

    const row = sessionRow(page, E2E_SESSION_ID)
    await expect(row.locator('.conv-badge.done')).toBeVisible()
    await expect
      .poll(async () => {
        const conversation = await page.evaluate(
          (id) => window.vav.conversations.get(id),
          E2E_SESSION_ID
        )
        return conversation?.resultUnseen ?? false
      })
      .toBe(true)
  } finally {
    await harness.dispose()
  }
})

test('selecting the completed session clears the Done badge', async () => {
  const harness = await launchVav({ stubTurn: true, extraSession: true })
  try {
    const { page } = harness
    await seedApiKey(page)
    await sessionRow(page, E2E_SESSION_B_ID).click()
    await page.evaluate(
      (id) => window.vav.agent.send(id, 'ping e2e', []),
      E2E_SESSION_ID
    )
    const row = sessionRow(page, E2E_SESSION_ID)
    await expect(row.locator('.conv-badge.done')).toBeVisible()

    await row.click()
    await expect(row).toHaveClass(/selected/)
    await expect(row.locator('.conv-badge.done')).toHaveCount(0)
    await expect
      .poll(async () => {
        const conversation = await page.evaluate(
          (id) => window.vav.conversations.get(id),
          E2E_SESSION_ID
        )
        return conversation?.resultUnseen ?? true
      })
      .toBe(false)
  } finally {
    await harness.dispose()
  }
})

test('foreground stub complete does not mark the open session unseen', async () => {
  const harness = await launchVav({ stubTurn: true })
  try {
    const { page } = harness
    await seedApiKey(page)
    await page.locator('[data-testid="composer-input"]').fill('ping e2e')
    await page.locator('[data-testid="composer-send"]').click()
    await expect(page.locator('[data-testid="message-assistant"]')).toContainText('e2e stub reply')

    await expect(sessionRow(page, E2E_SESSION_ID).locator('.conv-badge.done')).toHaveCount(0)
    const conversation = await page.evaluate(
      (id) => window.vav.conversations.get(id),
      E2E_SESSION_ID
    )
    expect(conversation?.resultUnseen ?? false).toBe(false)
  } finally {
    await harness.dispose()
  }
})
