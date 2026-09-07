import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { AccountStore } from '../store/AccountStore.ts'
import { NodeSecretStore } from '../store/NodeSecretStore.ts'
import { SettingsStore } from '../store/SettingsStore.ts'
import { createSettingsCatalog, vavAccountKeyPresent } from './settingsCatalog.ts'

describe('settings daemon catalog', () => {
  it('writes the API key onto the same apikey file Chrome Settings uses', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-settings-catalog-'))
    try {
      const settings = new SettingsStore(dir)
      const secrets = new NodeSecretStore(dir)
      settings.load()
      secrets.load()
      const catalog = createSettingsCatalog(settings, secrets)
      const page = catalog.get() as { apiKeyPresent?: boolean }
      assert.equal(page.apiKeyPresent, false)
      const set = catalog.setSecret('api', 'sk-hosted') as { hint?: string; apiKeyPresent?: boolean }
      assert.equal(set.apiKeyPresent, true)
      assert.equal(await readFile(join(dir, 'apikey'), 'utf8'), 'sk-hosted')
      assert.equal(catalog.revealSecret('api'), 'sk-hosted')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('treats a VAV account key as apiKeyPresent the same way desktop does', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-settings-vavkey-'))
    try {
      const settings = new SettingsStore(dir)
      const secrets = new NodeSecretStore(dir)
      const accounts = new AccountStore(dir)
      settings.load()
      secrets.load()
      accounts.load()
      const catalog = createSettingsCatalog(settings, secrets, {
        hasVavKey: () => vavAccountKeyPresent(accounts, secrets)
      })
      assert.equal((catalog.get() as { apiKeyPresent?: boolean }).apiKeyPresent, false)
      const created = accounts.add({
        workspaceKey: '__default__',
        agentId: 'vav',
        provider: 'vav',
        kind: 'vav_key',
        name: 'DeepSeek',
        endpoint: 'https://api.deepseek.com',
        usesLegacyApiKey: false,
        lastUsedAt: null,
        lastModel: null,
        keyStatus: 'unknown',
        oauthHost: null
      })
      secrets.setAccountKey(created.id, 'sk-account')
      assert.equal((catalog.get() as { apiKeyPresent?: boolean }).apiKeyPresent, true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
