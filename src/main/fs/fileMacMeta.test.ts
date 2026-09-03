import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { defaultAppJxaScript } from './fileMacMeta.ts'

describe('defaultAppJxaScript', () => {
  it('escapes backslashes and single quotes in the path', () => {
    const script = defaultAppJxaScript("/tmp/it's\\a.zip")
    assert.match(script, /fileURLWithPath\('\/tmp\/it\\'s\\\\a\.zip'\)/)
    assert.match(script, /NSWorkspace/)
    assert.match(script, /replace\(\/\\.app\$\/i/)
  })
})
