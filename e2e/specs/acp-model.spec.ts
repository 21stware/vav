import { existsSync, readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'
import { E2E_SESSION_B_ID, E2E_SESSION_ID, launchVav, sessionRow } from '../launch'

type ModelLog = { sessionId: string; modelId: string; ok: boolean }

function readModelLog(path: string | undefined): ModelLog[] {
  if (!path || !existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ModelLog)
}

function lastOk(log: ModelLog[], sessionId: string): ModelLog | undefined {
  return [...log].reverse().find((row) => row.sessionId === sessionId && row.ok)
}

/**
 * Cursor model pin: family names + thinking/fast chips, two sessions stay
 * on their own ACP model ids.
 */
test('picker shows a family name and thinking / fast chips on Cursor', async () => {
  const harness = await launchVav({ liveAcp: true })
  try {
    const { page } = harness
    await expect(page.locator('.agent-model-picker-model .model-name')).toHaveText(/Grok 4\.6/)
    await expect(page.locator('.agent-model-picker-model .model-name')).not.toHaveText(/Fast/i)
    await expect(page.locator('[data-testid="session-run-thinking"]')).toBeVisible()
    await expect(page.locator('[data-testid="session-run-fast"]')).toBeVisible()
    await expect(page.locator('[data-testid="session-run-controls"]')).toHaveAttribute(
      'data-fast',
      'false'
    )
  } finally {
    await harness.dispose()
  }
})

test('two live ACP conversations pin different models', async () => {
  const harness = await launchVav({ liveAcp: true, extraAcpSession: true })
  try {
    const { page, acpModelLog } = harness

    await page.locator('[data-testid="composer-input"]').fill('hello a')
    await page.locator('[data-testid="composer-send"]').click()
    await expect(page.locator('[data-testid="message-assistant"]')).toContainText('e2e acp reply', {
      timeout: 20_000
    })

    await sessionRow(page, E2E_SESSION_B_ID).click()
    await page.locator('[data-testid="composer-input"]').fill('hello b')
    await page.locator('[data-testid="composer-send"]').click()
    await expect(page.locator('[data-testid="message-assistant"]')).toContainText('e2e acp reply', {
      timeout: 20_000
    })

    const sessionA = await page.evaluate(async (id) => {
      const conversation = await window.vav.conversations.get(id)
      return conversation?.cliResumeCursor && 'sessionId' in conversation.cliResumeCursor
        ? conversation.cliResumeCursor.sessionId
        : null
    }, E2E_SESSION_ID)
    const sessionB = await page.evaluate(async (id) => {
      const conversation = await window.vav.conversations.get(id)
      return conversation?.cliResumeCursor && 'sessionId' in conversation.cliResumeCursor
        ? conversation.cliResumeCursor.sessionId
        : null
    }, E2E_SESSION_B_ID)

    expect(sessionA).toBeTruthy()
    expect(sessionB).toBeTruthy()
    expect(sessionA).not.toBe(sessionB)

    const log = readModelLog(acpModelLog)
    expect(log.some((row) => row.ok === false)).toBe(false)
    expect(lastOk(log, sessionA!)?.modelId).toBe('grok-4.6[effort=high,fast=false]')
    expect(lastOk(log, sessionB!)?.modelId).toBe(
      'claude-fable-5[thinking=true,context=300k,effort=high,fast=false]'
    )
  } finally {
    await harness.dispose()
  }
})

test('thinking level and fast overlay the pinned ACP model', async () => {
  const harness = await launchVav({ liveAcp: true })
  try {
    const { page, acpModelLog } = harness
    await page.locator('[data-testid="composer-input"]').fill('hello')
    await page.locator('[data-testid="composer-send"]').click()
    await expect(page.locator('[data-testid="message-assistant"]')).toContainText('e2e acp reply', {
      timeout: 20_000
    })

    const sessionId = await page.evaluate(async (id) => {
      const conversation = await window.vav.conversations.get(id)
      return conversation?.cliResumeCursor && 'sessionId' in conversation.cliResumeCursor
        ? conversation.cliResumeCursor.sessionId
        : null
    }, E2E_SESSION_ID)
    expect(sessionId).toBeTruthy()

    await page.evaluate(async (id) => {
      await window.vav.conversations.setThinkingLevel(id, 'low')
      await window.vav.conversations.setFast(id, true)
    }, E2E_SESSION_ID)
    await expect(page.locator('[data-testid="session-run-controls"]')).toHaveAttribute(
      'data-thinking',
      'low'
    )
    await expect(page.locator('[data-testid="session-run-controls"]')).toHaveAttribute(
      'data-fast',
      'true'
    )

    await expect
      .poll(() => lastOk(readModelLog(acpModelLog), sessionId!)?.modelId)
      .toBe('grok-4.6[effort=low,fast=true]')

    await page.locator('[data-testid="composer-input"]').fill('hello again')
    await expect(page.locator('[data-testid="composer-send"]')).toBeEnabled()
    await page.locator('[data-testid="composer-send"]').click()
    await expect
      .poll(() => lastOk(readModelLog(acpModelLog), sessionId!)?.modelId)
      .toBe('grok-4.6[effort=low,fast=true]')
  } finally {
    await harness.dispose()
  }
})
