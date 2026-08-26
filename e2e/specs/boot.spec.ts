import { test, expect } from '@playwright/test'
import { launchVav } from '../launch'

test('app boots past Keychain into an isolated English shell', async () => {
  const harness = await launchVav()
  try {
    const about = await harness.page.evaluate(async () => {
      const boot = await window.vav.bootstrap()
      return {
        version: boot.about.version,
        userDataPath: boot.about.userDataPath,
        locale: boot.resolvedLocale
      }
    })
    expect(about.version).toBeTruthy()
    expect(about.userDataPath).toBe(harness.userData)
    expect(about.locale).toBe('en')
    await expect(harness.page.locator('[data-testid="app-shell"]')).toBeVisible()
    await expect(harness.page.locator('[data-testid="keychain-onboarding"]')).toHaveCount(0)
  } finally {
    await harness.dispose()
  }
})
