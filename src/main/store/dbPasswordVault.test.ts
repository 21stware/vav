import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { dbAccountSecretFileName, siblingUserDataDirs } from './dbPasswordVault.ts'

describe('dbPasswordVault paths', () => {
  it('sanitizes the Electron account-secret filename', () => {
    assert.equal(
      dbAccountSecretFileName('6d5bf572-adca-4672-a8a8-a19898dce137'),
      'secret-account-db_6d5bf572-adca-4672-a8a8-a19898dce137.bin'
    )
  })

  it('includes vav and vav-dev next to the current userData', () => {
    const dirs = siblingUserDataDirs('/Users/me/Library/Application Support/vav-dev')
    assert.ok(dirs.includes('/Users/me/Library/Application Support/vav-dev'))
    assert.ok(dirs.includes('/Users/me/Library/Application Support/vav'))
  })
})
