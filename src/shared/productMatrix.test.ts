import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const root = join(import.meta.dirname, '../..')

describe('product matrix', () => {
  it('keeps desktop and vav-server on disk', () => {
    const paths = {
      'vav-server': 'packages/vav-server/src/vav-server.ts',
      'vav-desktop': 'packages/vav-desktop/package.json',
      'web-ui': 'src/web-ui/PhoneApp.tsx'
    }
    for (const [name, rel] of Object.entries(paths)) {
      assert.ok(existsSync(join(root, rel)), `${name} missing at ${rel}`)
    }
    assert.ok(existsSync(join(root, 'packages/vav-desktop/src/main/index.ts')), 'vav-desktop Electron entry missing')
    const matrix = readFileSync(join(root, 'docs/PRODUCT_MATRIX.md'), 'utf8')
    assert.match(matrix, /vav-server/)
    assert.match(matrix, /vav-desktop/)
    assert.match(matrix, /packages\/vav-desktop/)
  })
})
