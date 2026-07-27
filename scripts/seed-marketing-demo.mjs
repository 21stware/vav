#!/usr/bin/env node
/**
 * Seeds Application Support with a polished English demo conversation
 * for marketing screenshots.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const dataDir = join(homedir(), 'Library/Application Support/vav')
const convPath = join(dataDir, 'conversations.json')
const settingsPath = join(dataDir, 'settings.json')
const workdir = '/Users/oboo/repo/vav'
const now = Date.now()

function id() {
  return randomUUID()
}

function emptySession(title, updatedOffset, extras = {}) {
  const createdAt = now - updatedOffset - 86_400_000
  const updatedAt = now - updatedOffset
  return {
    id: id(),
    title,
    createdAt,
    updatedAt,
    workingDirectory: workdir,
    model: 'deepseek-v4-flash',
    tokensUsed: 12_000 + Math.floor(Math.random() * 40_000),
    tokenLimit: 200_000,
    pinned: false,
    pinTime: null,
    duplicateSourceId: null,
    duplicateSourceTitle: null,
    archived: false,
    archivedAt: null,
    approvalMode: 'auto',
    messages: [],
    activeLeafId: null,
    tokenHistory: [],
    cacheCreatedAt: null,
    cacheExpiresAt: null,
    ...extras
  }
}

const u1 = id()
const a1 = id()
const tRead = id()
const tTerm = id()
const tWrite = id()

const tokenHistory = [
  {
    turnIndex: 1,
    totalInputTokens: 8200,
    cacheReadTokens: 1200,
    cacheWriteTokens: 6400,
    newInputTokens: 600,
    outputTokens: 420,
    timestamp: now - 12 * 60_000,
    estimatedCost: 0.0042
  },
  {
    turnIndex: 2,
    totalInputTokens: 14_200,
    cacheReadTokens: 9800,
    cacheWriteTokens: 2800,
    newInputTokens: 1600,
    outputTokens: 880,
    timestamp: now - 8 * 60_000,
    estimatedCost: 0.0061
  },
  {
    turnIndex: 3,
    totalInputTokens: 21_600,
    cacheReadTokens: 17_400,
    cacheWriteTokens: 2100,
    newInputTokens: 2100,
    outputTokens: 1260,
    timestamp: now - 3 * 60_000,
    estimatedCost: 0.0078
  },
  {
    turnIndex: 4,
    totalInputTokens: 28_400,
    cacheReadTokens: 24_200,
    cacheWriteTokens: 1800,
    newInputTokens: 2400,
    outputTokens: 1540,
    timestamp: now - 60_000,
    estimatedCost: 0.0091
  }
]

const demo = {
  id: id(),
  title: 'Payment webhook idempotency',
  createdAt: now - 40 * 60_000,
  updatedAt: now + 60_000,
  workingDirectory: workdir,
  model: 'deepseek-v4-flash',
  tokensUsed: 48_620,
  tokenLimit: 200_000,
  pinned: true,
  pinTime: now - 5 * 60_000,
  duplicateSourceId: null,
  duplicateSourceTitle: null,
  archived: false,
  archivedAt: null,
  approvalMode: 'auto',
  activeLeafId: a1,
  tokenHistory,
  cacheCreatedAt: now - 4 * 60_000,
  cacheExpiresAt: now + 60_000,
  messages: [
    {
      id: u1,
      parentId: null,
      role: 'user',
      content:
        'Payment webhooks charge twice on retry. Find the root cause and ship a minimal fix.',
      blocks: [],
      createdAt: now - 6 * 60_000
    },
    {
      id: a1,
      parentId: u1,
      role: 'assistant',
      content:
        'Root cause: the webhook handler never dedupes on provider event id. Added a unique constraint and early return.',
      createdAt: now - 90_000,
      blocks: [
        {
          kind: 'reasoning',
          text: 'Check the webhook entrypoint and persistence layer for external event-id dedupe, then confirm against retry logs.'
        },
        {
          kind: 'toolCall',
          id: tRead,
          tool: 'fs_read',
          summary: 'Read src/billing/webhook.ts',
          input: JSON.stringify({ path: 'src/billing/webhook.ts' }),
          output:
            'export async function handleStripeWebhook(event) {\n  await db.charges.insert({ ...event.data.object })\n  return { ok: true }\n}\n',
          status: 'completed'
        },
        {
          kind: 'toolCall',
          id: tTerm,
          tool: 'terminal',
          summary: 'rg "handleStripeWebhook|event.id" src/billing',
          input: JSON.stringify({
            command: 'rg -n "handleStripeWebhook|event\\.id" src/billing'
          }),
          output:
            'src/billing/webhook.ts:12:export async function handleStripeWebhook(event) {\n' +
            'src/billing/webhook.ts:13:  await db.charges.insert({ ...event.data.object })\n' +
            'src/billing/ledger.ts:44:  // TODO: dedupe by provider event id\n',
          status: 'completed',
          targetTabId: 'agent'
        },
        {
          kind: 'toolCall',
          id: tWrite,
          tool: 'fs_write',
          summary: 'Write src/billing/webhook.ts',
          input: JSON.stringify({ path: 'src/billing/webhook.ts', content: '…' }),
          output: 'Wrote 38 lines to src/billing/webhook.ts',
          status: 'completed'
        },
        {
          kind: 'text',
          text:
            '**Root cause:** the webhook never dedupes on `event.id`, so retries insert again.\n\n' +
            '**Fix:** lookup-before-write, and keep charge + event insert in one transaction.\n\n' +
            '```ts\n' +
            'const existing = await db.webhookEvents.findById(event.id)\n' +
            'if (existing) return { ok: true, deduped: true }\n' +
            'await db.transaction(async (tx) => {\n' +
            '  await tx.webhookEvents.insert({ id: event.id, type: event.type })\n' +
            '  await applyCharge(tx, event.data.object)\n' +
            '})\n' +
            '```'
        }
      ]
    }
  ]
}

const conversations = [
  demo,
  emptySession('Split renderer components', 2 * 60 * 60_000, { tokensUsed: 36_200 }),
  emptySession('Fix flaky CI e2e', 5 * 60 * 60_000, { tokensUsed: 22_800 }),
  emptySession('Align dark theme tokens', 26 * 60 * 60_000, { tokensUsed: 41_100 }),
  emptySession('Sticky shell regression', 30 * 60 * 60_000, { tokensUsed: 18_400 })
]

mkdirSync(dataDir, { recursive: true })
if (existsSync(convPath)) {
  copyFileSync(convPath, `${convPath}.bak-marketing`)
}

writeFileSync(convPath, JSON.stringify({ version: 1, conversations }, null, 2))

if (existsSync(settingsPath)) {
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
  settings.theme = 'dark'
  settings.locale = 'en'
  settings.fileViewMode = 'tree'
  settings.sidebarGroupingMode = 'workspace'
  settings.defaultModel = 'deepseek-v4-flash'
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
}

console.log(convPath)
console.log('demoId', demo.id)
