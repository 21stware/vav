import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { localHostFs } from '../host/HostFs.ts'
import { localHostProcess, type HostChild } from '../host/HostProcess.ts'
import { getGitSnapshot, setGitHostFor } from './GitService.ts'

function resetGitHost(): void {
  setGitHostFor(() => ({
    kind: 'local',
    process: localHostProcess,
    fs: localHostFs
  }))
}

function remoteHost(handler: (args: string[]) => { stdout: string; code: number }) {
  return {
    kind: 'remote' as const,
    fs: {
      exists: async () => true
    },
    process: {
      spawn(_file: string, args: string[]) {
        const emitter = new EventEmitter()
        const stdout = new PassThrough()
        const stderr = new PassThrough()
        const child = Object.assign(emitter, {
          pid: 1,
          killed: false,
          stdin: null,
          stdout,
          stderr,
          kill: () => true,
          unref: () => undefined
        })
        queueMicrotask(() => {
          const result = handler(args)
          stdout.write(result.stdout)
          stdout.end()
          stderr.end()
          child.emit('close', result.code, null)
        })
        return child as unknown as HostChild
      }
    }
  }
}

describe('GitService remote host', () => {
  afterEach(() => {
    resetGitHost()
  })

  it('does not treat a coincidental local repo as the remote workdir', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-git-local-'))
    try {
      execFileSync('git', ['init'], { cwd: dir })
      setGitHostFor(() =>
        remoteHost((args) => {
          if (args.includes('--is-inside-work-tree')) {
            return { stdout: 'false\n', code: 0 }
          }
          return { stdout: '', code: 1 }
        })
      )
      const snap = await getGitSnapshot(dir)
      assert.equal(snap.isRepo, false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('runs git on the remote host when the adapter is remote', async () => {
    const seen: string[][] = []
    setGitHostFor(() =>
      remoteHost((args) => {
        seen.push(args)
        if (args.includes('--is-inside-work-tree')) return { stdout: 'true\n', code: 0 }
        if (args.includes('--show-toplevel')) return { stdout: '/remote/proj\n', code: 0 }
        if (args.includes('--show-current')) return { stdout: 'main\n', code: 0 }
        if (args.includes('--short')) return { stdout: 'abc1234\n', code: 0 }
        if (args.includes('--porcelain') && args.includes('status')) {
          return { stdout: '?? remote-only.md\n', code: 0 }
        }
        if (args.includes('for-each-ref')) return { stdout: 'main\n', code: 0 }
        if (args.includes('worktree')) {
          return { stdout: 'worktree /remote/proj\nHEAD abc\nbranch refs/heads/main\n', code: 0 }
        }
        return { stdout: '', code: 0 }
      })
    )

    const snap = await getGitSnapshot('/remote/proj')
    assert.equal(snap.isRepo, true)
    assert.equal(snap.branch, 'main')
    assert.equal(
      snap.changes.some((c) => c.path === 'remote-only.md'),
      true
    )
    assert.ok(seen.some((args) => args[0] === 'rev-parse'))
  })
})
