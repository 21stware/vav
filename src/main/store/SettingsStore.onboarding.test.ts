import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsStore } from './SettingsStore.ts'

function userDir(): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'vav-onboarding-')), 'user')
  mkdirSync(dir, { recursive: true })
  return dir
}

describe('SettingsStore first-launch setup', () => {
  it('starts a fresh install with setup pending', () => {
    assert.equal(new SettingsStore(userDir()).load().onboardingCompleted, false)
  })

  it('marks settings saved before setup existed as done', () => {
    const dir = userDir()
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ theme: 'dark' }))
    assert.equal(new SettingsStore(dir).load().onboardingCompleted, true)
  })

  it('keeps an explicit pending flag across launches', () => {
    const dir = userDir()
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ onboardingCompleted: false }))
    assert.equal(new SettingsStore(dir).load().onboardingCompleted, false)
  })

  it('treats conversations or a finished Keychain tour as an existing install', () => {
    const withConversations = userDir()
    mkdirSync(join(withConversations, 'conversations'))
    assert.equal(new SettingsStore(withConversations).load().onboardingCompleted, true)

    const withKeychain = userDir()
    writeFileSync(join(withKeychain, 'keychain-onboarding-done'), '1\n')
    assert.equal(new SettingsStore(withKeychain).load().onboardingCompleted, true)
  })
})
