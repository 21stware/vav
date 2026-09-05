import { test, expect } from '@playwright/test'
import { E2E_SESSION_ID, launchVav } from '../launch'

/**
 * Transient network failures must self-recover on the SAME session: the
 * fixture rejects the first session/prompt with a Node TLS disconnect
 * (RetriableError), VAV backs off and re-prompts, and the turn completes
 * with no error surfaced and no context loss.
 */
test('network error on prompt retries in place and completes the turn', async () => {
  const harness = await launchVav({ liveAcp: true, acpFailPrompts: 1 })
  try {
    const { page } = harness
    await page.locator('[data-testid="composer-input"]').fill('flaky network probe')
    await page.locator('[data-testid="composer-send"]').click()

    // Reply lands despite the first prompt failing (1s backoff + retry).
    const assistant = page.locator('[data-testid="message-assistant"]')
    await expect(assistant).toContainText('e2e acp reply', { timeout: 25_000 })

    const conversation = await page.evaluate(
      (id) => window.vav.conversations.get(id),
      E2E_SESSION_ID
    )
    // One user message, one clean assistant message — no error, no break.
    const assistants = (conversation?.messages ?? []).filter(
      (m: { role: string }) => m.role === 'assistant'
    )
    expect(assistants).toHaveLength(1)
    expect(assistants[0].errorText ?? null).toBeNull()
    expect(assistants[0].cancelled ?? false).toBe(false)
    // The resume cursor survived — the retry did not mint a fresh session.
    expect(conversation?.cliResumeCursor?.sessionId ?? null).not.toBeNull()
  } finally {
    await harness.dispose()
  }
})

/**
 * When the network stays down past the retry budget, the turn must fail with
 * the friendly network message — and the next send must work once the
 * network is back (context preserved, same session).
 */
test('exhausted network retries surface a clear error, then recover on resend', async () => {
  const harness = await launchVav({ liveAcp: true, acpFailPrompts: 4 })
  try {
    const { page } = harness
    await page.locator('[data-testid="composer-input"]').fill('dead network probe')
    await page.locator('[data-testid="composer-send"]').click()

    // 1 initial + 3 retries (1s + 2.5s + 5s backoff) all fail → error.
    await expect
      .poll(
        async () => {
          const conversation = await page.evaluate(
            (id) => window.vav.conversations.get(id),
            E2E_SESSION_ID
          )
          const last = (conversation?.messages ?? []).at(-1)
          return last?.errorText ?? null
        },
        { timeout: 30_000 }
      )
      .toMatch(/network|网络/i)

    // Network is "back" (fail budget consumed) — resend completes cleanly.
    await page.locator('[data-testid="composer-input"]').fill('after the outage')
    await page.locator('[data-testid="composer-send"]').click()
    const assistant = page.locator('[data-testid="message-assistant"]').last()
    await expect(assistant).toContainText('e2e acp reply', { timeout: 25_000 })
  } finally {
    await harness.dispose()
  }
})

/**
 * cursor-agent ACP bug: an internal stream teardown ("Error: RetriableError:
 * WritableIterable is closed") leaks as a trailing agent_message_chunk while
 * the turn still reports end_turn. When the real reply completed first, VAV
 * must strip the leaked tail and seal a clean message — no retry needed.
 */
test('streamed retriable error trailing a full reply is stripped from the transcript', async () => {
  const harness = await launchVav({ liveAcp: true, acpLeakTail: true })
  try {
    const { page } = harness
    await page.locator('[data-testid="composer-input"]').fill('tail leak probe')
    await page.locator('[data-testid="composer-send"]').click()

    const assistant = page.locator('[data-testid="message-assistant"]')
    await expect(assistant).toContainText('e2e acp reply', { timeout: 25_000 })
    await expect(assistant).not.toContainText('RetriableError')

    const conversation = await page.evaluate(
      (id) => window.vav.conversations.get(id),
      E2E_SESSION_ID
    )
    const last = (conversation?.messages ?? []).at(-1)
    expect(last?.content ?? '').toContain('e2e acp reply')
    expect(last?.content ?? '').not.toContain('RetriableError')
    expect(last?.errorText ?? null).toBeNull()
    // Benign teardown after a complete reply must not kick a continue.
    expect(last?.content ?? '').not.toContain('e2e continued')
  } finally {
    await harness.dispose()
  }
})

/**
 * Same leak, but the streamed error was the WHOLE reply: the turn produced
 * nothing, so VAV must run the same-session network retry ladder and seal
 * the retried reply — the leaked error never reaches the transcript.
 */
test('streamed retriable error as the whole reply retries in place and seals clean', async () => {
  const harness = await launchVav({ liveAcp: true, acpLeakPrompts: 1 })
  try {
    const { page } = harness
    await page.locator('[data-testid="composer-input"]').fill('whole reply leak probe')
    await page.locator('[data-testid="composer-send"]').click()

    // Reply lands after the leaked first attempt (1s backoff + retry).
    const assistant = page.locator('[data-testid="message-assistant"]')
    await expect(assistant).toContainText('e2e acp reply', { timeout: 25_000 })
    await expect(assistant).not.toContainText('RetriableError')

    const conversation = await page.evaluate(
      (id) => window.vav.conversations.get(id),
      E2E_SESSION_ID
    )
    const assistants = (conversation?.messages ?? []).filter(
      (m: { role: string }) => m.role === 'assistant'
    )
    expect(assistants).toHaveLength(1)
    expect(assistants[0].content ?? '').not.toContain('RetriableError')
    expect(assistants[0].errorText ?? null).toBeNull()
    expect(assistants[0].cancelled ?? false).toBe(false)
    // Same session survived — the retry did not mint a fresh one.
    expect(conversation?.cliResumeCursor?.sessionId ?? null).not.toBeNull()
  } finally {
    await harness.dispose()
  }
})

/**
 * Mid-outputting network change: cursor-agent leaks a TLS disconnect as a
 * trailing chunk after a PARTIAL reply and still reports end_turn. VAV must
 * keep the draft, flip Outputting → Recovering, continue on the same session,
 * and seal one assistant message — the user must not type "continue".
 */
test('partial reply cut off by a transport leak continues on the same turn', async () => {
  const harness = await launchVav({ liveAcp: true, acpLeakPartialTransport: true })
  try {
    const { page } = harness
    await page.locator('[data-testid="composer-input"]').fill('upgrade compile env')
    await page.locator('[data-testid="composer-send"]').click()

    const streaming = page.locator('[data-testid="streaming-message"]')
    await expect(streaming).toBeVisible({ timeout: 15_000 })
    await expect(streaming).toContainText('partial e2e reply', { timeout: 15_000 })
    await expect(
      page.locator('[data-testid="stream-status"][data-state="healing"]')
    ).toBeVisible({ timeout: 8_000 })
    await expect(streaming).not.toContainText('RetriableError')

    const assistant = page.locator('[data-testid="message-assistant"]')
    await expect(assistant).toContainText('partial e2e reply', { timeout: 25_000 })
    await expect(assistant).toContainText('e2e continued', { timeout: 25_000 })
    await expect(assistant).not.toContainText('RetriableError')

    const conversation = await page.evaluate(
      (id) => window.vav.conversations.get(id),
      E2E_SESSION_ID
    )
    const users = (conversation?.messages ?? []).filter(
      (m: { role: string }) => m.role === 'user'
    )
    const assistants = (conversation?.messages ?? []).filter(
      (m: { role: string }) => m.role === 'assistant'
    )
    expect(users).toHaveLength(1)
    expect(assistants).toHaveLength(1)
    expect(assistants[0].content ?? '').toContain('partial e2e reply')
    expect(assistants[0].content ?? '').toContain('e2e continued')
    expect(assistants[0].content ?? '').not.toContain('RetriableError')
    expect(assistants[0].errorText ?? null).toBeNull()
    expect(assistants[0].cancelled ?? false).toBe(false)
    expect(conversation?.cliResumeCursor?.sessionId ?? null).not.toBeNull()
  } finally {
    await harness.dispose()
  }
})
