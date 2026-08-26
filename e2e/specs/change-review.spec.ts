import { test, expect } from '@playwright/test'
import { launchVav } from '../launch'

/**
 * Shipped review is inline in the transcript (sessionStore change-review),
 * not the full-screen panel in session/change-review.rpml.
 * Accept All still resolves every pending file.
 */
test('inline change review lists seeded files and accept-all resolves them', async () => {
  const harness = await launchVav({ seedReview: true })
  try {
    const { page } = harness
    const review = page.locator('[data-testid="inline-review"]')
    await expect(review).toBeVisible({ timeout: 20_000 })
    await expect(page.locator('[data-testid="inline-review-file"]')).toHaveCount(2)
    await expect(page.locator('[data-testid="inline-review-file"][data-name$="existing.ts"]')).toBeVisible()
    await expect(page.locator('[data-testid="inline-review-file"][data-name$="added.ts"]')).toBeVisible()

    await page.locator('[data-testid="inline-review-accept-all"]').click()
    await expect(review).toHaveClass(/is-resolved/)
    await expect(page.locator('.banner.review-pending')).toHaveCount(0)
  } finally {
    await harness.dispose()
  }
})
