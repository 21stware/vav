import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { assertDevUserData, DEV_USER_DATA_NAME, devUserDataDir } from './dev-user-data.mjs'

test('devUserDataDir is vav-dev under Application Support', () => {
  const dir = devUserDataDir()
  assert.equal(dir, join(homedir(), 'Library/Application Support', DEV_USER_DATA_NAME))
})

test('assertDevUserData refuses the packaged profile', () => {
  assert.throws(
    () => assertDevUserData(join(homedir(), 'Library/Application Support', 'vav')),
    /non-dev userData/
  )
})
