import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DEFAULT_SETTINGS } from './types.ts'
import {
  mergeHostSettings,
  omitHostSettings,
  pickHostSettings,
  pickSecretPresent
} from './hostSettings.ts'

describe('hostSettings', () => {
  it('picks daemon fields and leaves appearance on the client', () => {
    const patch = pickHostSettings({
      defaultModel: 'deepseek-chat',
      theme: 'dark',
      apiEndpoint: 'https://api.example.com'
    })
    assert.equal(patch.defaultModel, 'deepseek-chat')
    assert.equal(patch.apiEndpoint, 'https://api.example.com')
    assert.equal('theme' in patch, false)
    const local = omitHostSettings({ theme: 'dark', defaultModel: 'x' })
    assert.equal(local.theme, 'dark')
    assert.equal('defaultModel' in local, false)
    const merged = mergeHostSettings(DEFAULT_SETTINGS, { defaultModel: 'hosted' })
    assert.equal(merged.defaultModel, 'hosted')
    assert.equal(merged.theme, DEFAULT_SETTINGS.theme)
    const secrets = pickSecretPresent({ apiKeyPresent: true, theme: 'dark' })
    assert.equal(secrets.apiKeyPresent, true)
    assert.equal('theme' in secrets, false)
  })
})
