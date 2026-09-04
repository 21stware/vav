import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createLocalHostPty } from './HostPty.ts'

describe('createLocalHostPty', () => {
  it('spawns, exits, and tear-down after exit does not throw', async () => {
    const pty = createLocalHostPty()
    const proc = pty.spawn(process.execPath, ['-e', 'process.stdout.write("pty-ok")'], {
      cols: 80,
      rows: 24,
      cwd: process.cwd()
    })
    let data = ''
    let timeout: ReturnType<typeof setTimeout> | undefined
    const finished = new Promise<number>((resolve) => {
      proc.onData((chunk) => {
        data += chunk
      })
      proc.onExit((e) => resolve(e.exitCode))
    })
    const code = await Promise.race([
      finished,
      new Promise<number>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`pty timeout, data=${JSON.stringify(data)}`)), 8000)
        timeout.unref?.()
      })
    ]).finally(() => {
      if (timeout) clearTimeout(timeout)
    })
    assert.equal(code, 0)
    assert.match(data, /pty-ok/)
    assert.doesNotThrow(() => proc.kill())
  })
})
