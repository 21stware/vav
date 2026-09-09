import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { encodeDaemonPairing } from '../../shared/daemonProtocol.ts'
import { writeListenState } from '../daemon/listenState.ts'
import {
  defaultStateDirs,
  positionalArgs,
  resolveVavServerTarget,
  secretFromState,
  targetFromState,
  targetFromUri
} from './vavServerTarget.ts'

describe('vavServerTarget', () => {
  it('parses a pairing URI and flag overrides', () => {
    const uri = encodeDaemonPairing({
      v: 1,
      secret: '0123456789abcdef01234567',
      machineId: 'm1',
      name: 'box',
      host: '10.0.0.2',
      port: 4750
    })
    const target = targetFromUri(uri, { host: '127.0.0.1', port: '4800' })
    assert.ok(target)
    assert.equal(target.kind, 'tcp')
    assert.equal(target.host, '127.0.0.1')
    assert.equal(target.port, 4800)
    assert.equal(target.secret, '0123456789abcdef01234567')
  })

  it('reads secret.json + listen.json from a state dir', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-server-target-'))
    try {
      writeFileSync(join(dir, 'secret.json'), JSON.stringify({ secret: '0123456789abcdef01234567' }))
      writeListenState(dir, { host: '127.0.0.1', port: 5123 })
      assert.equal(secretFromState(dir), '0123456789abcdef01234567')
      const target = targetFromState(dir)
      assert.ok(target)
      assert.equal(target.port, 5123)
      assert.equal(target.source, `state:${dir}`)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('resolves --uri before state dirs', async () => {
    const uri = encodeDaemonPairing({
      v: 1,
      secret: 'abcdefghijklmnopabcdefgh',
      machineId: 'm1',
      name: 'box',
      host: '127.0.0.1',
      port: 4999
    })
    const target = await resolveVavServerTarget({
      argv: ['node', 'vav-board', '--uri', uri],
      discover: false
    })
    assert.equal(target.kind, 'tcp')
    if (target.kind === 'tcp') {
      assert.equal(target.port, 4999)
      assert.equal(target.secret, 'abcdefghijklmnopabcdefgh')
    }
  })

  it('uses VAV_SERVER_STATE before ~/.vav-server', () => {
    const dirs = defaultStateDirs({ VAV_SERVER_STATE: '/tmp/custom-vav-server', HOME: '/Users/demo' }, '/Users/demo')
    assert.equal(dirs[0], '/tmp/custom-vav-server')
    assert.ok(dirs.includes(join('/Users/demo', '.vav-server')))
  })

  it('skips flag values when collecting positionals', () => {
    assert.deepEqual(
      positionalArgs(
        ['node', 'vav-board', 'session', 'create', '--cwd', '/tmp/proj', '--json', 'extra'],
        new Set(['--cwd'])
      ),
      ['session', 'create', 'extra']
    )
  })

  it('rejects an empty state dir when discover is off', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-server-empty-'))
    mkdirSync(dir, { recursive: true })
    await assert.rejects(
      () =>
        resolveVavServerTarget({
          argv: ['node', 'vav-board', '--state', dir],
          env: {},
          discover: false
        }),
      /no pairing secret/
    )
    await rm(dir, { recursive: true, force: true })
  })
})
