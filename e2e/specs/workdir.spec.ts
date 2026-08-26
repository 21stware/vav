import { test, expect } from '@playwright/test'
import { realpathSync } from 'node:fs'
import {
  chooseNativeMenu,
  E2E_SESSION_ID,
  extraWorkspaceLabel,
  launchVav,
  openFilesTray,
  pressAccelerator
} from '../launch'

/**
 * Workdir switcher — chip action / ⌘⇧O. Temp folders and recents only;
 * "Choose another folder…" opens a native dialog and is out of scope.
 */
test('chip action switches to a recent project folder and refreshes Files', async () => {
  const harness = await launchVav({ extraWorkspace: true })
  try {
    const { page, extraWorkspace } = harness
    if (!extraWorkspace) throw new Error('expected extraWorkspace')

    await page.locator('[data-testid="workdir-chip"] [data-testid="chip-action"]').click()
    await chooseNativeMenu(page, extraWorkspaceLabel(extraWorkspace))

    const expected = realpathSync(extraWorkspace)
    await expect
      .poll(async () => {
        const conversation = await page.evaluate(
          (id) => window.vav.conversations.get(id),
          E2E_SESSION_ID
        )
        const next = conversation?.workingDirectory
        return next ? realpathSync(next) : null
      })
      .toBe(expected)

    await openFilesTray(page)
    await expect(page.locator('[data-file-path$="other.md"]')).toBeVisible()
    await expect(page.locator('[data-file-path$="hello.md"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="workdir-chip"] .chip-label')).not.toHaveText('TEMP DIR')
  } finally {
    await harness.dispose()
  }
})

test('⌘⇧O → A new temp folder leaves the seeded files behind', async () => {
  const harness = await launchVav()
  try {
    const { page } = harness
    await pressAccelerator(harness, 'Meta+Shift+o')
    await chooseNativeMenu(page, 'A new temp folder')

    await expect
      .poll(async () => {
        const conversation = await page.evaluate(
          (id) => window.vav.conversations.get(id),
          E2E_SESSION_ID
        )
        return conversation?.workingDirectory ?? null
      })
      .not.toBe(harness.workspace)

    await openFilesTray(page)
    await expect(page.locator('[data-file-path$="hello.md"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="workdir-chip"] .chip-label')).toHaveText('TEMP DIR')
  } finally {
    await harness.dispose()
  }
})
