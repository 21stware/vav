import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'
import { callCuaTool } from './CuaDriverClient.ts'

function fakeSpawn(exitCode: number, stdout: string) {
  return ((_bin: string, argv: readonly string[]) => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      kill: () => void
    }
    child.stdout = new EventEmitter() as EventEmitter & { setEncoding: () => void }
    child.stderr = new EventEmitter() as EventEmitter & { setEncoding: () => void }
    ;(child.stdout as { setEncoding: () => void }).setEncoding = () => undefined
    ;(child.stderr as { setEncoding: () => void }).setEncoding = () => undefined
    child.kill = () => undefined
    queueMicrotask(() => {
      child.stdout.emit('data', stdout)
      child.emit('close', exitCode)
    })
    assert.equal(argv[0], 'call')
    assert.ok(argv.includes('--socket'))
    return child
  }) as typeof import('node:child_process').spawn
}

describe('callCuaTool', () => {
  it('pretty-prints JSON stdout and reports success', async () => {
    const result = await callCuaTool({
      bin: '/bin/cua-driver',
      socket: '/tmp/s',
      tool: 'list_apps',
      spawnImpl: fakeSpawn(0, '{"apps":[]}\n')
    })
    assert.equal(result.ok, true)
    assert.match(result.text, /"apps"/)
  })

  it('fails when the process exits non-zero', async () => {
    const result = await callCuaTool({
      bin: '/bin/cua-driver',
      socket: '/tmp/s',
      tool: 'click',
      spawnImpl: fakeSpawn(1, 'refused')
    })
    assert.equal(result.ok, false)
    assert.match(result.text, /refused/)
  })
})
