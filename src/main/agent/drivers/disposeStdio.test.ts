import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'
import { disposeStdioProcess } from './disposeStdio.ts'
import { spawnStdioProcess } from './process.ts'

describe('disposeStdioProcess', () => {
  it('closes stdin, SIGTERMs after grace, then SIGKILLs', () => {
    mock.timers.enable({ apis: ['setTimeout'] })
    try {
      const signals: NodeJS.Signals[] = []
      const exitListeners: Array<() => void> = []
      const proc = {
        stdinClosed: false,
        child: {
          killed: false,
          once(_event: 'exit', listener: () => void) {
            exitListeners.push(listener)
            return this
          }
        },
        closeStdin() {
          this.stdinClosed = true
        },
        kill(signal?: NodeJS.Signals) {
          signals.push(signal ?? 'SIGTERM')
          // Node sets `killed` when the signal is delivered, not on exit.
          this.child.killed = true
          if (signal === 'SIGKILL') {
            for (const listener of exitListeners) listener()
          }
        }
      }

      disposeStdioProcess(proc, { graceMs: 100 })
      assert.equal(proc.stdinClosed, true)
      assert.deepEqual(signals, [])

      mock.timers.tick(100)
      assert.deepEqual(signals, ['SIGTERM'])

      mock.timers.tick(100)
      assert.deepEqual(signals, ['SIGTERM', 'SIGKILL'])
    } finally {
      mock.timers.reset()
    }
  })

  it('does not SIGKILL if the child exits after SIGTERM', () => {
    mock.timers.enable({ apis: ['setTimeout'] })
    try {
      const signals: NodeJS.Signals[] = []
      const exitListeners: Array<() => void> = []
      const proc = {
        child: {
          killed: false,
          once(_event: 'exit', listener: () => void) {
            exitListeners.push(listener)
            return this
          }
        },
        closeStdin() {},
        kill(signal?: NodeJS.Signals) {
          signals.push(signal ?? 'SIGTERM')
          if (signal === 'SIGTERM') {
            this.child.killed = true
            for (const listener of exitListeners) listener()
          }
        }
      }

      disposeStdioProcess(proc, { graceMs: 50 })
      mock.timers.tick(50)
      assert.deepEqual(signals, ['SIGTERM'])
      mock.timers.tick(50)
      assert.deepEqual(signals, ['SIGTERM'])
    } finally {
      mock.timers.reset()
    }
  })

  it('SIGKILLs a child that ignores SIGTERM, including its grandchild', async (t) => {
    if (process.platform === 'win32') {
      t.skip('process-group SIGKILL is POSIX-only')
      return
    }
    const proc = spawnStdioProcess(
      'bash',
      ['-c', "trap '' TERM; sleep 60 & wait"],
      process.cwd()
    )
    const pid = proc.child.pid
    assert.ok(pid && pid > 0)
    try {
      disposeStdioProcess(proc, { graceMs: 80 })
      const deadline = Date.now() + 2_000
      while (Date.now() < deadline) {
        if (proc.child.exitCode != null || proc.child.signalCode != null) break
        await new Promise((resolve) => setTimeout(resolve, 40))
      }
      assert.ok(
        proc.child.exitCode != null || proc.child.signalCode != null,
        'child should have exited after SIGKILL'
      )
      assert.throws(
        () => process.kill(-pid, 0),
        (err: NodeJS.ErrnoException) => err.code === 'ESRCH'
      )
    } finally {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        /* already gone */
      }
    }
  })
})
