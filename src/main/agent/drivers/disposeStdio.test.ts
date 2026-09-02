import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'
import { disposeStdioProcess } from './disposeStdio.ts'

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
          if (signal === 'SIGKILL') {
            this.child.killed = true
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
})
