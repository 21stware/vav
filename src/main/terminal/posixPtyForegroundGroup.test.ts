import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  getPosixPtyForegroundGroup,
  normalizeTty,
  parseProcessRows,
  signalPosixPtyForegroundGroup
} from './posixPtyForegroundGroup.ts'

describe('normalizeTty', () => {
  it('strips a /dev/ prefix so ps and node-pty names compare', () => {
    assert.equal(normalizeTty('/dev/ttys003'), 'ttys003')
    assert.equal(normalizeTty('ttys003'), 'ttys003')
    assert.equal(normalizeTty('/dev/pts/3'), 'pts/3')
  })
})

describe('parseProcessRows', () => {
  it('reads pid, tpgid, and tty from ps -o pid=,tpgid=,tty=', () => {
    const rows = parseProcessRows('84644  84985 ttys318\n  99  99 ttys318\n')
    assert.equal(rows.length, 2)
    assert.deepEqual(rows[0], { pid: 84644, tpgid: 84985, tty: 'ttys318' })
  })

  it('keeps a negative tpgid (no foreground group)', () => {
    const rows = parseProcessRows('100  -1 ttys001')
    assert.equal(rows[0]?.tpgid, -1)
  })
})

describe('getPosixPtyForegroundGroup', () => {
  const table = ['84644  84985 ttys318', '  99   99 ttys999'].join('\n')

  it('returns the tty tpgid when the root still owns the spawn pts', () => {
    assert.equal(getPosixPtyForegroundGroup(table, 84644, '/dev/ttys318', 99), 84985)
  })

  it('returns null when the pid has been recycled onto another tty', () => {
    assert.equal(getPosixPtyForegroundGroup(table, 84644, '/dev/ttys001', 99), null)
  })

  it('returns null when this process shares the PTY (dev daemon inherit)', () => {
    const shared = ['84644  84985 ttys318', '  99   99 ttys318'].join('\n')
    assert.equal(getPosixPtyForegroundGroup(shared, 84644, '/dev/ttys318', 99), null)
  })

  it('returns null when tpgid is not a real process group', () => {
    assert.equal(
      getPosixPtyForegroundGroup('84644  1 ttys318\n  99  99 ttys999', 84644, 'ttys318', 99),
      null
    )
    assert.equal(
      getPosixPtyForegroundGroup('84644  -1 ttys318\n  99  99 ttys999', 84644, 'ttys318', 99),
      null
    )
  })

  it('returns null when the root has no usable tty', () => {
    assert.equal(
      getPosixPtyForegroundGroup('84644  84985 ??\n  99  99 ttys999', 84644, 'ttys318', 99),
      null
    )
  })
})

describe('signalPosixPtyForegroundGroup', () => {
  it('signals the foreground group, not the login/shell root pid', () => {
    const killed: number[] = []
    signalPosixPtyForegroundGroup(
      84644,
      '/dev/ttys318',
      'SIGWINCH',
      () => {
        throw new Error('must not fall back')
      },
      {
        platform: 'darwin',
        currentPid: 99,
        readProcessTable: () => '84644  84985 ttys318\n  99  99 ttys999',
        kill: (pid) => {
          killed.push(pid)
        }
      }
    )
    assert.deepEqual(killed, [-84985])
  })

  it('falls back on Windows and when pts is missing', () => {
    let fallbacks = 0
    signalPosixPtyForegroundGroup(1, '/dev/ttys001', 'SIGWINCH', () => {
      fallbacks++
    }, { platform: 'win32' })
    signalPosixPtyForegroundGroup(1, undefined, 'SIGWINCH', () => {
      fallbacks++
    }, { platform: 'darwin' })
    assert.equal(fallbacks, 2)
  })

  it('falls back when the process table cannot be read', () => {
    let fallbacks = 0
    signalPosixPtyForegroundGroup(1, '/dev/ttys001', 'SIGWINCH', () => {
      fallbacks++
    }, {
      platform: 'darwin',
      readProcessTable: () => {
        throw new Error('ps failed')
      }
    })
    assert.equal(fallbacks, 1)
  })

  it('treats ESRCH on the group as success (job already exited)', () => {
    let fallbacks = 0
    signalPosixPtyForegroundGroup(
      84644,
      '/dev/ttys318',
      'SIGWINCH',
      () => {
        fallbacks++
      },
      {
        platform: 'darwin',
        currentPid: 99,
        readProcessTable: () => '84644  84985 ttys318\n  99  99 ttys999',
        kill: () => {
          const err = new Error('gone') as NodeJS.ErrnoException
          err.code = 'ESRCH'
          throw err
        }
      }
    )
    assert.equal(fallbacks, 0)
  })
})
