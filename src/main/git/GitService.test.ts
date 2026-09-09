import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { localHostFs } from '../host/HostFs.ts'
import { localHostProcess, type HostChild } from '../host/HostProcess.ts'
import {
  checkoutGitBranch,
  createGitBranch,
  deleteGitBranch,
  getGitPatch,
  getGitSnapshot,
  listGitBranches,
  listGitLog,
  listGitStashes,
  setGitHostFor,
  stashGitApply,
  stashGitDrop,
  stashGitPush
} from './GitService.ts'

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

describe('GitService inherited git env', () => {
  afterEach(() => {
    resetGitHost()
  })

  it('does not let GIT_DIR from the parent process hide a real workdir', async () => {
    const other = await mkdtemp(join(tmpdir(), 'vav-git-other-'))
    const dir = await mkdtemp(join(tmpdir(), 'vav-git-cwd-'))
    const prev = process.env.GIT_DIR
    try {
      execFileSync('git', ['init', '-b', 'main'], { cwd: other })
      execFileSync('git', ['init', '-b', 'main'], { cwd: dir })
      await writeFile(join(dir, 'hello.md'), 'from cwd\n')
      execFileSync('git', ['add', 'hello.md'], { cwd: dir })
      execFileSync('git', ['-c', 'user.email=e2e@vav.test', '-c', 'user.name=e2e', 'commit', '-m', 'seed'], {
        cwd: dir
      })
      const before = await getGitSnapshot(dir)
      assert.equal(before.isRepo, true, `baseline ${JSON.stringify(before)}`)
      process.env.GIT_DIR = join(other, '.git')
      const snap = await getGitSnapshot(dir)
      assert.equal(snap.isRepo, true, `with GIT_DIR ${JSON.stringify(snap)}`)
      assert.equal(snap.cwd, dir)
    } finally {
      if (prev === undefined) delete process.env.GIT_DIR
      else process.env.GIT_DIR = prev
      await rm(other, { recursive: true, force: true })
      await rm(dir, { recursive: true, force: true })
    }
  })
})

function gitIdentity(cwd: string, args: string[]): void {
  execFileSync('git', ['-c', 'user.email=e2e@vav.test', '-c', 'user.name=e2e', ...args], { cwd })
}

describe('GitService log / branches / stashes', () => {
  afterEach(() => {
    resetGitHost()
  })

  it('lists commits, local and origin branches, and stashes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-git-refs-'))
    try {
      execFileSync('git', ['init', '-b', 'main'], { cwd: dir })
      await writeFile(join(dir, 'hello.md'), 'one\n')
      gitIdentity(dir, ['add', 'hello.md'])
      gitIdentity(dir, ['commit', '-m', 'seed'])
      gitIdentity(dir, ['branch', 'topic'])
      execFileSync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: dir })
      await writeFile(join(dir, 'hello.md'), 'two\n')
      gitIdentity(dir, ['stash', 'push', '-m', 'wip'])

      const log = await listGitLog(dir)
      assert.equal(log.ok, true)
      if (!log.ok) return
      assert.equal(log.data.commits[0]?.subject, 'seed')
      assert.ok(log.data.commits[0]?.sha)

      const branches = await listGitBranches(dir)
      assert.equal(branches.ok, true)
      if (!branches.ok) return
      assert.equal(branches.data.local.some((b) => b.name === 'main' && b.current), true)
      assert.equal(branches.data.local.some((b) => b.name === 'topic'), true)
      assert.equal(branches.data.remote.some((b) => b.fullName === 'origin/main'), true)

      const stashes = await listGitStashes(dir)
      assert.equal(stashes.ok, true)
      if (!stashes.ok) return
      assert.equal(stashes.data.stashes.length, 1)
      assert.match(stashes.data.stashes[0]!.subject, /wip/)

      const patch = await getGitPatch(dir, log.data.commits[0]!.sha)
      assert.equal(patch.ok, true)
      if (!patch.ok) return
      assert.match(patch.data, /seed/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('creates a branch from a start point and deletes it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-git-branch-'))
    try {
      execFileSync('git', ['init', '-b', 'main'], { cwd: dir })
      await writeFile(join(dir, 'hello.md'), 'one\n')
      gitIdentity(dir, ['add', 'hello.md'])
      gitIdentity(dir, ['commit', '-m', 'seed'])
      const created = await createGitBranch(dir, 'from-here', { checkout: false, startPoint: 'main' })
      assert.equal(created.ok, true)
      const branches = await listGitBranches(dir)
      assert.equal(branches.ok, true)
      if (!branches.ok) return
      assert.equal(branches.data.local.some((b) => b.name === 'from-here'), true)
      const deleted = await deleteGitBranch(dir, 'from-here')
      assert.equal(deleted.ok, true)
      const after = await listGitBranches(dir)
      assert.equal(after.ok, true)
      if (!after.ok) return
      assert.equal(after.data.local.some((b) => b.name === 'from-here'), false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('checks out a remote-tracking branch onto a local name', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-git-track-'))
    try {
      execFileSync('git', ['init', '-b', 'main'], { cwd: dir })
      await writeFile(join(dir, 'hello.md'), 'one\n')
      gitIdentity(dir, ['add', 'hello.md'])
      gitIdentity(dir, ['commit', '-m', 'seed'])
      execFileSync('git', ['update-ref', 'refs/remotes/origin/feature', 'HEAD'], { cwd: dir })
      const checked = await checkoutGitBranch(dir, 'origin/feature')
      assert.equal(checked.ok, true)
      if (!checked.ok) return
      assert.equal(checked.data.branch, 'feature')
      const snap = await getGitSnapshot(dir)
      assert.equal(snap.branch, 'feature')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('applies and drops a stash', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vav-git-stash-'))
    try {
      execFileSync('git', ['init', '-b', 'main'], { cwd: dir })
      await writeFile(join(dir, 'hello.md'), 'one\n')
      gitIdentity(dir, ['add', 'hello.md'])
      gitIdentity(dir, ['commit', '-m', 'seed'])
      await writeFile(join(dir, 'hello.md'), 'two\n')
      const pushed = await stashGitPush(dir, { message: 'hold' })
      assert.equal(pushed.ok, true)
      const clean = await getGitSnapshot(dir)
      assert.equal(clean.changes.length, 0)
      const applied = await stashGitApply(dir, 0)
      assert.equal(applied.ok, true)
      const dirty = await getGitSnapshot(dir)
      assert.equal(
        dirty.changes.some((c) => c.path === 'hello.md'),
        true
      )
      const dropped = await stashGitDrop(dir, 0)
      assert.equal(dropped.ok, true)
      const stashes = await listGitStashes(dir)
      assert.equal(stashes.ok, true)
      if (!stashes.ok) return
      assert.equal(stashes.data.stashes.length, 0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
