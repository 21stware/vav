import { test, expect } from '@playwright/test'
import { E2E_SESSION_ID, launchVav } from '../launch'

/**
 * Cursor createPlan contract (verified against cursor-agent 2026.08.25):
 * the agent holds `cursor/create_plan` open while `session/prompt` is still
 * in flight, then — once the client answers "accepted" — ends the turn with
 * stopReason end_turn WITHOUT implementing anything. The client must send
 * the follow-up prompt itself. Accepting the plan card must therefore keep
 * the same turn going instead of sealing the conversation.
 */
test('accepting a plan auto-continues the same turn', async () => {
  const harness = await launchVav({ liveAcp: true, acpPlan: true })
  try {
    const { page } = harness
    await page.locator('[data-testid="composer-input"]').fill('plan accept probe')
    await page.locator('[data-testid="composer-send"]').click()

    // The plan card arrives while session/prompt is still open.
    const planCard = page.locator('[data-testid="plan-doc"]')
    await expect(planCard).toBeVisible({ timeout: 25_000 })
    await planCard.getByRole('button', { name: 'Accept plan' }).click()
    await expect(planCard).toHaveAttribute('data-status', 'completed', { timeout: 10_000 })

    // The fixture ends the planning turn right after Accept; VAV must
    // re-prompt on the same turn so implementation output streams in.
    const assistant = page.locator('[data-testid="message-assistant"]')
    await expect(assistant).toContainText('e2e implementing plan', { timeout: 25_000 })

    // One user message and one continuous assistant turn — no break, no
    // error, no synthetic user bubble.
    await expect
      .poll(
        async () => {
          const conversation = await page.evaluate(
            (id) => window.vav.conversations.get(id),
            E2E_SESSION_ID
          )
          const messages = (conversation?.messages ?? []) as Array<{
            role: string
            errorText?: string | null
            cancelled?: boolean
          }>
          return {
            users: messages.filter((m) => m.role === 'user').length,
            assistants: messages.filter((m) => m.role === 'assistant').length,
            error: messages.at(-1)?.errorText ?? null,
            cancelled: messages.at(-1)?.cancelled ?? false
          }
        },
        { timeout: 15_000 }
      )
      .toEqual({ users: 1, assistants: 1, error: null, cancelled: false })
  } finally {
    await harness.dispose()
  }
})
