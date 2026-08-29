import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { toolDisplayName } from './toolDisplayName.ts'

describe('toolDisplayName', () => {
  it('uses the human card name, not the schema id', () => {
    assert.equal(toolDisplayName('fs_read', 'zh-CN'), '读取文件')
    assert.equal(toolDisplayName('terminal', 'zh-CN'), '终端')
    assert.equal(toolDisplayName('fs_read', 'en'), 'Read file')
    assert.equal(toolDisplayName('terminal', 'en'), 'Terminal')
  })

  it('humanizes leftover CLI ids', () => {
    assert.equal(toolDisplayName('read_file', 'zh-CN'), '读取文件')
    assert.equal(toolDisplayName('shell', 'en'), 'Terminal')
    assert.match(toolDisplayName('cursor_read'), /Read/i)
  })
})
