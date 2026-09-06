import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  copyFilesAppleScript,
  copyFilesPowerShell,
  escapeAppleScriptString,
  escapePowerShellSingleQuoted,
  getInfoAppleScript,
  propertiesPowerShell,
  sanitizeDragPaths,
  splitDirName,
  startDragItem
} from './fileNativeTransfer.ts'

describe('escapeAppleScriptString', () => {
  it('escapes backslashes and double quotes', () => {
    assert.equal(escapeAppleScriptString('a"b\\c'), 'a\\"b\\\\c')
  })
})

describe('escapePowerShellSingleQuoted', () => {
  it('doubles single quotes', () => {
    assert.equal(escapePowerShellSingleQuoted("it's"), "it''s")
  })
})

describe('splitDirName', () => {
  it('splits POSIX and Windows paths', () => {
    assert.deepEqual(splitDirName('/tmp/hello.md'), { dir: '/tmp', name: 'hello.md' })
    assert.deepEqual(splitDirName('C:\\Users\\a\\b.txt'), { dir: 'C:\\Users\\a', name: 'b.txt' })
    assert.deepEqual(splitDirName('readme'), { dir: '', name: 'readme' })
  })
})

describe('copyFilesAppleScript', () => {
  it('emits a POSIX file for a single path', () => {
    const script = copyFilesAppleScript(['/tmp/it\'s "a".md'])
    assert.equal(script, 'set the clipboard to (POSIX file "/tmp/it\'s \\"a\\".md")')
  })

  it('emits a list for several paths', () => {
    const script = copyFilesAppleScript(['/a', '/b'])
    assert.equal(script, 'set the clipboard to {POSIX file "/a", POSIX file "/b"}')
  })
})

describe('getInfoAppleScript', () => {
  it('opens Finder’s information window', () => {
    const script = getInfoAppleScript('/tmp/hello.md')
    assert.match(script, /tell application "Finder"/)
    assert.match(script, /open information window of \(POSIX file "\/tmp\/hello\.md" as alias\)/)
  })
})

describe('copyFilesPowerShell', () => {
  it('builds a CF_HDROP clipboard write', () => {
    const script = copyFilesPowerShell(["C:\\Users\\a\\it's.txt"])
    assert.match(script, /System\.Windows\.Forms/)
    assert.match(script, /SetFileDropList/)
    assert.match(script, /\$files\.Add\('C:\\Users\\a\\it''s\.txt'\)/)
  })
})

describe('propertiesPowerShell', () => {
  it('invokes the Explorer Properties verb', () => {
    const script = propertiesPowerShell('C:\\Users\\a\\b.txt')
    assert.match(script, /NameSpace\('C:\\Users\\a'\)/)
    assert.match(script, /ParseName\('b\.txt'\)/)
    assert.match(script, /InvokeVerb\('Properties'\)/)
  })
})

describe('sanitizeDragPaths', () => {
  const exists = (path: string): boolean => path.startsWith('/ok/')
  const allowed = (path: string): boolean => !path.includes('secret')

  it('drops non-strings, empties, NULs, missing, and denied paths', () => {
    assert.deepEqual(
      sanitizeDragPaths(
        ['/ok/a', '', '/missing', '/ok/secret', '/ok/a', 'x\0y', 12, null, '/ok/b'],
        allowed,
        exists
      ),
      ['/ok/a', '/ok/b']
    )
  })

  it('rejects a non-array payload', () => {
    assert.deepEqual(sanitizeDragPaths('/ok/a', allowed, exists), [])
  })
})

describe('startDragItem', () => {
  it('uses file for one path and files for many', () => {
    assert.deepEqual(startDragItem(['/a'], 'icon'), { file: '/a', icon: 'icon' })
    assert.deepEqual(startDragItem(['/a', '/b'], 'icon'), {
      file: '/a',
      files: ['/a', '/b'],
      icon: 'icon'
    })
    assert.equal(startDragItem([], 'icon'), null)
  })
})
