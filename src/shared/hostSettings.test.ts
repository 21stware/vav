import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DEFAULT_SETTINGS } from './types.ts'
import {
  composeHostSettings,
  mergeHostSettings,
  omitHostSettings,
  pickHostSettings,
  pickSecretPresent,
  remapHostWorkspaceSettings
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

  it('remaps remote host recents onto the paired machine id', () => {
    const hostId = 'macmini-v1'
    const extra = '/tmp/host-extra'
    const home = '/tmp/host-home'
    const remapped = remapHostWorkspaceSettings(
      {
        recentWorkspaceDirectories: [extra, { machineId: 'local', path: home }]
      },
      hostId
    )
    assert.deepEqual(remapped.recentWorkspaceDirectories, [
      { machineId: hostId, path: extra },
      { machineId: hostId, path: home }
    ])
    const written = remapHostWorkspaceSettings(
      remapped,
      hostId,
      'toHost'
    )
    assert.deepEqual(written.recentWorkspaceDirectories, [
      { machineId: 'local', path: extra },
      { machineId: 'local', path: home }
    ])

    const adopted = '/tmp/catalog-only'
    const merged = composeHostSettings(
      {
        ...DEFAULT_SETTINGS,
        recentWorkspaceDirectories: [{ machineId: hostId, path: adopted }]
      },
      { recentWorkspaceDirectories: [extra], defaultModel: 'hosted' },
      hostId
    )
    assert.equal(merged.defaultModel, 'hosted')
    assert.deepEqual(merged.recentWorkspaceDirectories, [
      { machineId: hostId, path: extra },
      { machineId: hostId, path: adopted }
    ])
  })
})
