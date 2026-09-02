import { test, expect } from '@playwright/test'
import { E2E_SESSION_ID, launchVav } from '../launch'

/**
 * Live Grok ACP fixture (`grok agent stdio` shape). No vendor CLI.
 */
test('Grok ACP turn streams a reply, thinking chip, and slash commands', async () => {
  const harness = await launchVav({ liveAcp: true, liveAcpHost: 'grok' })
  try {
    const { page } = harness
    await expect(page.getByText('E2E Grok ACP live')).toBeVisible()
    await page.locator('[data-testid="composer-input"]').fill('hello grok')
    await page.locator('[data-testid="composer-send"]').click()

    const assistant = page.locator('[data-testid="message-assistant"]')
    await expect(assistant).toContainText('e2e acp reply', { timeout: 20_000 })

    const controls = page.locator('[data-testid="session-run-controls"]')
    await expect(controls).toHaveAttribute('data-thinking', /low|medium|high/)
    await expect(page.locator('[data-testid="session-run-thinking"]')).toBeVisible()
    await expect(page.locator('[data-testid="session-run-mode"]')).toHaveCount(0)

    await expect
      .poll(async () => {
        const conversation = await page.evaluate(
          (id) => window.vav.conversations.get(id),
          E2E_SESSION_ID
        )
        return {
          host: conversation?.cliHost ?? null,
          mode: conversation?.acpSession?.currentModeId ?? null,
          modes: conversation?.acpSession?.modes?.length ?? 0,
          thinking: conversation?.acpSession?.thinkingLevels ?? []
        }
      })
      .toEqual({
        host: 'grok',
        mode: null,
        modes: 0,
        thinking: ['low', 'medium', 'high']
      })

    await page.locator('[data-testid="composer-input"]').fill('/')
    await expect(page.locator('[data-testid="acp-slash-compact"]')).toBeVisible()
  } finally {
    await harness.dispose()
  }
})

test('Grok follow-up stays on the same native session', async () => {
  const harness = await launchVav({ liveAcp: true, liveAcpHost: 'grok' })
  try {
    const { page } = harness
    await page.locator('[data-testid="composer-input"]').fill('first turn')
    await page.locator('[data-testid="composer-send"]').click()
    await expect(page.locator('[data-testid="message-assistant"]')).toContainText('e2e acp reply', {
      timeout: 20_000
    })

    const firstCursor = await page.evaluate(
      (id) => window.vav.conversations.get(id)?.cliResumeCursor ?? null,
      E2E_SESSION_ID
    )
    expect(firstCursor && 'sessionId' in firstCursor ? firstCursor.sessionId : null).toBeTruthy()

    await page.locator('[data-testid="composer-input"]').fill('second turn')
    await page.locator('[data-testid="composer-send"]').click()
    await expect(page.locator('[data-testid="message-assistant"]').last()).toContainText(
      'e2e acp reply',
      { timeout: 20_000 }
    )

    const conversation = await page.evaluate(
      (id) => window.vav.conversations.get(id),
      E2E_SESSION_ID
    )
    const users = (conversation?.messages ?? []).filter((m: { role: string }) => m.role === 'user')
    const assistants = (conversation?.messages ?? []).filter(
      (m: { role: string }) => m.role === 'assistant'
    )
    expect(users).toHaveLength(2)
    expect(assistants).toHaveLength(2)
    expect(conversation?.cliResumeCursor?.sessionId ?? null).toBe(
      firstCursor && 'sessionId' in firstCursor ? firstCursor.sessionId : null
    )
    expect(assistants.every((m: { errorText?: string | null }) => !m.errorText)).toBe(true)
  } finally {
    await harness.dispose()
  }
})

test('Grok plan accept auto-continues the same turn', async () => {
  const harness = await launchVav({ liveAcp: true, liveAcpHost: 'grok', acpPlan: true })
  try {
    const { page } = harness
    await page.locator('[data-testid="composer-input"]').fill('plan accept probe')
    await page.locator('[data-testid="composer-send"]').click()

    const planCard = page.locator('[data-testid="plan-doc"]')
    await expect(planCard).toBeVisible({ timeout: 25_000 })
    await planCard.getByRole('button', { name: 'Accept plan' }).click()
    await expect(planCard).toHaveAttribute('data-status', 'completed', { timeout: 10_000 })

    const assistant = page.locator('[data-testid="message-assistant"]')
    await expect(assistant).toContainText('e2e implementing plan', { timeout: 25_000 })

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

test('Grok network error retries in place and completes the turn', async () => {
  const harness = await launchVav({ liveAcp: true, liveAcpHost: 'grok', acpFailPrompts: 1 })
  try {
    const { page } = harness
    await page.locator('[data-testid="composer-input"]').fill('flaky grok probe')
    await page.locator('[data-testid="composer-send"]').click()

    const assistant = page.locator('[data-testid="message-assistant"]')
    await expect(assistant).toContainText('e2e acp reply', { timeout: 25_000 })

    const conversation = await page.evaluate(
      (id) => window.vav.conversations.get(id),
      E2E_SESSION_ID
    )
    const assistants = (conversation?.messages ?? []).filter(
      (m: { role: string }) => m.role === 'assistant'
    )
    expect(assistants).toHaveLength(1)
    expect(assistants[0].errorText ?? null).toBeNull()
    expect(conversation?.cliResumeCursor?.sessionId ?? null).not.toBeNull()
  } finally {
    await harness.dispose()
  }
})
