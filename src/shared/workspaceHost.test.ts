import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  LOCAL_MACHINE_ID,
  conversationOnMachine,
  formatWorkspaceLabel,
  hostJoin,
  isLocalMachine,
  normalizeMachineId,
  parseWorkspaceRefList,
  pruneForgottenWorkspaceDirs,
  recentsForMachine,
  workspaceRef
} from './workspaceHost.ts'

describe('normalizeMachineId', () => {
  it('treats empty as local', () => {
    assert.equal(normalizeMachineId(null), LOCAL_MACHINE_ID)
    assert.equal(normalizeMachineId(''), LOCAL_MACHINE_ID)
    assert.equal(normalizeMachineId('  '), LOCAL_MACHINE_ID)
  })

  it('keeps a remote id', () => {
    assert.equal(normalizeMachineId('build-server'), 'build-server')
  })
})

describe('isLocalMachine', () => {
  it('is true for missing and local', () => {
    assert.equal(isLocalMachine(undefined), true)
    assert.equal(isLocalMachine(LOCAL_MACHINE_ID), true)
  })

  it('is false for a paired machine', () => {
    assert.equal(isLocalMachine('build-server'), false)
  })
})

describe('formatWorkspaceLabel', () => {
  it('leaves local paths unprefixed', () => {
    assert.equal(formatWorkspaceLabel(null, '~/repo/vav'), '~/repo/vav')
    assert.equal(formatWorkspaceLabel(LOCAL_MACHINE_ID, '~/repo/vav'), '~/repo/vav')
  })

  it('prefixes a remote machine id', () => {
    assert.equal(formatWorkspaceLabel('build-server', '~/repo/vav'), 'build-server : ~/repo/vav')
  })

  it('prefers the human host name', () => {
    assert.equal(
      formatWorkspaceLabel('abc123', '~/repo/vav', 'Studio Mac'),
      'Studio Mac : ~/repo/vav'
    )
  })
})

describe('workspaceRef', () => {
  it('normalizes a missing machine onto local', () => {
    assert.deepEqual(workspaceRef('/tmp/x'), { machineId: LOCAL_MACHINE_ID, path: '/tmp/x' })
  })
})

describe('parseWorkspaceRefList', () => {
  it('lifts legacy path strings onto local', () => {
    assert.deepEqual(parseWorkspaceRefList(['/tmp/a', { machineId: 'box', path: '/home/me' }]), [
      { machineId: LOCAL_MACHINE_ID, path: '/tmp/a' },
      { machineId: 'box', path: '/home/me' }
    ])
  })

  it('filters recents to one machine', () => {
    const list = parseWorkspaceRefList([
      '/tmp/local',
      { machineId: 'box', path: '/srv/app' },
      { machineId: 'box', path: '/srv/other' }
    ])
    assert.deepEqual(recentsForMachine(list, 'box').map((r) => r.path), ['/srv/app', '/srv/other'])
    assert.deepEqual(recentsForMachine(list, LOCAL_MACHINE_ID).map((r) => r.path), ['/tmp/local'])
  })
})

describe('pruneForgottenWorkspaceDirs', () => {
  it('drops by path when the machine is unknown, and skips a no-op', () => {
    const recent = parseWorkspaceRefList([
      '/tmp/a',
      { machineId: 'box', path: '/tmp/a' },
      { machineId: 'box', path: '/srv/app' }
    ])
    const next = pruneForgottenWorkspaceDirs(recent, ['/tmp/a', '/keep'], '/tmp/a', null)
    assert.deepEqual(next?.recent.map((r) => r.path), ['/srv/app'])
    assert.deepEqual(next?.pinned, ['/keep'])
    assert.equal(pruneForgottenWorkspaceDirs(recent, ['/keep'], '/missing', 'box'), null)
  })

  it('drops only the matching host ref when machineId is set', () => {
    const recent = parseWorkspaceRefList([
      '/tmp/a',
      { machineId: 'box', path: '/tmp/a' }
    ])
    const next = pruneForgottenWorkspaceDirs(recent, [], '/tmp/a', 'box')
    assert.deepEqual(next?.recent, [{ machineId: LOCAL_MACHINE_ID, path: '/tmp/a' }])
  })
})

describe('hostJoin', () => {
  it('uses posix on darwin/linux', () => {
    assert.equal(hostJoin('darwin', '/Users/me', 'repo'), '/Users/me/repo')
    assert.equal(hostJoin('linux', '/home/me', 'src', 'vav'), '/home/me/src/vav')
  })

  it('uses backslash on win32', () => {
    assert.equal(hostJoin('win32', 'C:\\Users\\me', 'repo'), 'C:\\Users\\me\\repo')
  })
})

describe('conversationOnMachine', () => {
  it('treats a missing machineId as local', () => {
    assert.equal(conversationOnMachine({}, LOCAL_MACHINE_ID), true)
    assert.equal(conversationOnMachine({ machineId: null }, 'box'), false)
  })

  it('matches a paired daemon', () => {
    assert.equal(conversationOnMachine({ machineId: 'box' }, 'box'), true)
    assert.equal(conversationOnMachine({ machineId: 'box' }, LOCAL_MACHINE_ID), false)
  })
})
