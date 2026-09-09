import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const root = join(import.meta.dirname, '../..')

describe('product matrix', () => {
  it('keeps the seven products on disk', () => {
    const paths = {
      'vav-server': 'packages/vav-server/src/vav-server.ts',
      'vav-desktop': 'packages/vav-desktop/package.json',
      'vav-tui': 'packages/vav-tui/src/vav-tui.ts',
      'vav-board': 'packages/vav-board/src/vav-board.ts',
      'vav-iOS': 'packages/vav-ios/VAVRemote/VAVRemote/RemoteClient.swift',
      'vav-android': 'packages/vav-android/VAVRemote/app/src/main/java/com/vav/remote/RemoteClient.kt',
      'vav-chrome-extension': 'packages/vav-chrome-extension/extension/background.js'
    }
    for (const [name, rel] of Object.entries(paths)) {
      assert.ok(existsSync(join(root, rel)), `${name} missing at ${rel}`)
    }
    assert.ok(existsSync(join(root, 'packages/vav-desktop/src/main/index.ts')), 'vav-desktop Electron entry missing')
    const matrix = readFileSync(join(root, 'docs/PRODUCT_MATRIX.md'), 'utf8')
    for (const name of Object.keys(paths)) {
      assert.match(matrix, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    }
    assert.match(matrix, /packages\/vav-desktop/)
  })
})
