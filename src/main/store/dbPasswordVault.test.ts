import assert from 'node:assert/strict'
import { join } from 'node:path'
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
    const parent = join('/Users/me/Library/Application Support')
    const dirs = siblingUserDataDirs(join(parent, 'vav-dev'))
    assert.ok(dirs.includes(join(parent, 'vav-dev')))
    assert.ok(dirs.includes(join(parent, 'vav')))
  })
})
