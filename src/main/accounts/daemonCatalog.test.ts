import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { AccountStore } from '../store/AccountStore.ts'
import { ConversationStore } from '../store/ConversationStore.ts'
import { NodeSecretStore } from '../store/NodeSecretStore.ts'
import { SettingsStore } from '../store/SettingsStore.ts'
import { createAccountsCatalog } from './daemonCatalog.ts'

describe('accounts daemon catalog', () => {
  it('lists and drafts a key account on the same store Chrome Settings reads', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-accounts-catalog-'))
    try {
      const accounts = new AccountStore(dir)
      const secrets = new NodeSecretStore(dir)
      const settings = new SettingsStore(dir)
      const conversations = new ConversationStore(dir)
      accounts.load()
      secrets.load()
      settings.load()
      conversations.load({ model: 'test', mintWorkdir: () => dir })
      const catalog = createAccountsCatalog({
        accounts,
        secrets: secrets.asSecretStore(),
        settings,
        conversations
      })
      const empty = catalog.getPage() as { accounts?: unknown[] }
      assert.ok(Array.isArray(empty.accounts))
      const drafted = catalog.createDraft({ agentId: 'vav', kind: 'vav_key' }) as {
        id?: string
        page?: { accounts?: Array<{ id?: string; name?: string }> }
      }
      assert.ok(drafted.id)
      assert.ok(drafted.page?.accounts?.some((row) => row.id === drafted.id))
      const listed = catalog.getPage() as { accounts?: Array<{ id?: string }> }
      assert.ok(listed.accounts?.some((row) => row.id === drafted.id))
      const after = catalog.remove(drafted.id!) as { accounts?: Array<{ id?: string }> }
      assert.equal(after.accounts?.some((row) => row.id === drafted.id), false)
      await assert.rejects(() => catalog.beginOAuth('vav'), /找不到这个账户|That account is gone/)
      await assert.rejects(() => catalog.beginOAuth('not-a-host'), /找不到这个账户|That account is gone/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
