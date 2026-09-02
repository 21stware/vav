import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import type {
  GitChangeEntry,
  GitFileStatus,
  GitResult,
  GitSnapshot,
  GitWorktreeInfo
} from '@shared/git'
import { localHostFs, type HostFs } from '../host/HostFs.ts'
import { localHostProcess, type HostChild, type HostProcess } from '../host/HostProcess.ts'

const execFileAsync = promisify(execFile)
const GIT_TIMEOUT_MS = 20_000
const MAX_BUFFER = 8 * 1024 * 1024

export type GitHostAdapter = {
  kind: 'local' | 'remote'
  process: HostProcess
  fs: Pick<HostFs, 'exists'>
}

let resolveGitHost: (cwd: string, conversationId?: string) => GitHostAdapter = () => ({
  kind: 'local',
  process: localHostProcess,
  fs: localHostFs
})

/** Route git CLI + exists checks onto a workspace host (local or daemon). */
export function setGitHostFor(
  fn: (cwd: string, conversationId?: string) => GitHostAdapter
): void {
  resolveGitHost = fn
}

async function gitEnv(kind: 'local' | 'remote'): Promise<NodeJS.ProcessEnv> {
  const extra = {
    GIT_TERMINAL_PROMPT: '0',
    LANG: 'C'
  }
  if (kind === 'remote') return extra
  const { loginPath } = await import('../terminal/loginPath.ts')
  return {
    ...process.env,
    PATH: loginPath(),
    ...extra
  }
}

function absCwd(cwd: string, kind: 'local' | 'remote'): string {
  if (kind !== 'local') return cwd
  return resolve(cwd)
}

function joinGitPath(cwd: string, rel: string): string {
  if (!rel) return cwd
  if (isAbsolute(rel) || /^[A-Za-z]:[\\/]/.test(rel)) return rel
  const win = /^[A-Za-z]:[\\/]/.test(cwd) || (cwd.includes('\\') && !cwd.startsWith('/'))
  if (win) {
    return `${cwd.replace(/[\\/]+$/, '')}\\${rel.replace(/^[\\/]+/, '').replace(/\//g, '\\')}`
  }
  if (cwd.startsWith('/')) {
    return `${cwd.replace(/\/+$/, '')}/${rel.replace(/^\/+/, '')}`
  }
  return resolve(cwd, rel)
}

function sameHostPath(a: string, b: string): boolean {
  if (a === b) return true
  const left = a.replace(/\\/g, '/').replace(/\/+$/, '')
  const right = b.replace(/\\/g, '/').replace(/\/+$/, '')
  if (left === right) return true
  try {
    return resolve(a) === resolve(b)
  } catch {
    return false
  }
}

function collectChild(
  child: HostChild
): Promise<{ stdout: Buffer; stderr: Buffer; code: number }> {
  return new Promise((resolvePromise, reject) => {
    const out: Buffer[] = []
    const err: Buffer[] = []
    let settled = false
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      done(1)
    }, GIT_TIMEOUT_MS)
    const done = (code: number | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePromise({
        stdout: Buffer.concat(out),
        stderr: Buffer.concat(err),
        code: code ?? 1
      })
    }
    child.stdout?.on('data', (chunk) => out.push(Buffer.from(chunk)))
    child.stderr?.on('data', (chunk) => err.push(Buffer.from(chunk)))
    child.on('error', (e) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => done(code))
  })
}

async function git(
  cwd: string,
  args: string[],
  opts?: { allowFail?: boolean; conversationId?: string }
): Promise<{ stdout: string; stderr: string; code: number; stdoutBuf: Buffer }> {
  const host = resolveGitHost(cwd, opts?.conversationId)
  const abs = absCwd(cwd, host.kind)
  if (host.kind !== 'local') {
    try {
      const child = host.process.spawn('git', args, {
        cwd: abs,
        env: await gitEnv('remote'),
        stdio: ['ignore', 'pipe', 'pipe']
      })
      const result = await collectChild(child)
      if (result.code !== 0 && !opts?.allowFail) {
        const detail = result.stderr.toString('utf8').trim() || 'git failed'
        throw new Error(detail.slice(0, 400))
      }
      return {
        stdout: result.stdout.toString('utf8'),
        stderr: result.stderr.toString('utf8'),
        code: result.code,
        stdoutBuf: result.stdout
      }
    } catch (err) {
      if (opts?.allowFail) {
        const message = err instanceof Error ? err.message : String(err)
        return { stdout: '', stderr: message, code: 1, stdoutBuf: Buffer.alloc(0) }
      }
      throw err
    }
  }

  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd: abs,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      encoding: 'buffer',
      env: await gitEnv('local')
    })
    const stdoutBuf = Buffer.isBuffer(stdout) ? stdout : Buffer.from(String(stdout))
    const stderrBuf = Buffer.isBuffer(stderr) ? stderr : Buffer.from(String(stderr))
    return {
      stdout: stdoutBuf.toString('utf8'),
      stderr: stderrBuf.toString('utf8'),
      code: 0,
      stdoutBuf
    }
  } catch (err) {
    const e = err as {
      stdout?: string | Buffer
      stderr?: string | Buffer
      code?: number | string
      message?: string
      killed?: boolean
    }
    const stdoutBuf = Buffer.isBuffer(e.stdout)
      ? e.stdout
      : Buffer.from(e.stdout?.toString() ?? '')
    const stderrText = e.stderr?.toString() ?? e.message ?? ''
    if (opts?.allowFail) {
      return {
        stdout: stdoutBuf.toString('utf8'),
        stderr: stderrText,
        code: typeof e.code === 'number' ? e.code : 1,
        stdoutBuf
      }
    }
    const detail = (stderrText || 'git failed').trim()
    throw new Error(detail.slice(0, 400))
  }
}

async function cwdReady(
  cwd: string,
  conversationId?: string
): Promise<{ abs: string; ok: boolean }> {
  const host = resolveGitHost(cwd, conversationId)
  const abs = absCwd(cwd, host.kind)
  if (!abs) return { abs, ok: false }
  if (host.kind === 'local') return { abs, ok: existsSync(abs) }
  try {
    return { abs, ok: await host.fs.exists(abs) }
  } catch {
    return { abs, ok: false }
  }
}

function mapStatus(code: string): GitFileStatus {
  const x = code[0] ?? ' '
  const y = code[1] ?? ' '
  if (code === '??') return 'untracked'
  if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) {
    return 'conflict'
  }
  const primary = y !== ' ' && y !== '?' ? y : x
  switch (primary) {
    case 'M':
      return 'modified'
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    case 'T':
      return 'typechange'
    case '?':
      return 'untracked'
    default:
      return 'unknown'
  }
}

function parsePorcelain(cwd: string, text: string): GitChangeEntry[] {
  const out: GitChangeEntry[] = []
  for (const raw of text.split('\n')) {
    if (raw.length < 3) continue
    const code = raw.slice(0, 2)
    let rest = raw.slice(3)
    // rename: "R  old -> new"
    if ((code[0] === 'R' || code[0] === 'C') && rest.includes(' -> ')) {
      rest = rest.split(' -> ').pop() ?? rest
    }
    const rel = rest.replace(/^"|"$/g, '').replace(/\\([\\"ntr])/g, (_, c: string) => {
      if (c === 'n') return '\n'
      if (c === 't') return '\t'
      if (c === 'r') return '\r'
      return c
    })
    if (!rel) continue
    const staged = code[0] !== ' ' && code[0] !== '?'
    const unstaged = code[1] !== ' ' || code === '??'
    out.push({
      path: rel,
      absolutePath: joinGitPath(cwd, rel),
      status: mapStatus(code),
      code,
      staged,
      unstaged
    })
  }
  return out
}

function parseWorktrees(
  cwd: string,
  text: string,
  primaryPath: string | null
): GitWorktreeInfo[] {
  const blocks = text.split(/\n(?=worktree )/).filter((b) => b.trim())
  const list: GitWorktreeInfo[] = []
  let index = 0
  for (const block of blocks) {
    const lines = block.split('\n')
    let path = ''
    let branch: string | null = null
    let bare = false
    let detached = false
    for (const line of lines) {
      if (line.startsWith('worktree ')) path = line.slice('worktree '.length)
      else if (line.startsWith('branch ')) {
        const ref = line.slice('branch '.length)
        branch = ref.replace(/^refs\/heads\//, '')
      } else if (line === 'bare') bare = true
      else if (line === 'detached') detached = true
    }
    if (!path) continue
    const isPrimary =
      index === 0 || (!!primaryPath && sameHostPath(path, primaryPath))
    const isCurrent = sameHostPath(path, cwd)
    list.push({
      path,
      branch: detached ? null : branch,
      bare,
      detached,
      isCurrent,
      isPrimary,
      label: isPrimary ? 'Local' : basename(path)
    })
    index++
  }
  // Ensure exactly one primary when possible.
  if (list.length && !list.some((w) => w.isPrimary)) {
    list[0]!.isPrimary = true
    list[0]!.label = 'Local'
  }
  return list
}

async function resolvePrimaryWorktreePath(
  cwd: string,
  conversationId?: string
): Promise<string | null> {
  const listed = await git(cwd, ['worktree', 'list', '--porcelain'], {
    allowFail: true,
    conversationId
  })
  if (listed.code !== 0) return null
  const first = listed.stdout.split('\n').find((l) => l.startsWith('worktree '))
  return first ? first.slice('worktree '.length) : null
}

export async function getGitSnapshot(
  cwd: string,
  conversationId?: string
): Promise<GitSnapshot> {
  const ready = await cwdReady(cwd, conversationId)
  const abs = ready.abs
  const projectFallback = basename(abs) || abs
  const empty = (extra?: Partial<GitSnapshot>): GitSnapshot => ({
    cwd: abs,
    isRepo: false,
    toplevel: null,
    projectName: projectFallback,
    branch: null,
    detached: false,
    headShort: null,
    worktreeLabel: 'Local',
    isAdditionalWorktree: false,
    worktrees: [],
    branches: [],
    changes: [],
    ...extra
  })

  if (!abs || !ready.ok) {
    return empty({ error: 'Working directory missing' })
  }

  const inside = await git(abs, ['rev-parse', '--is-inside-work-tree'], {
    allowFail: true,
    conversationId
  })
  if (inside.code !== 0 || inside.stdout.trim() !== 'true') {
    return empty()
  }

  try {
    const [toplevelRes, branchRes, headRes, statusRes, branchListRes, worktreeRes] =
      await Promise.all([
        git(abs, ['rev-parse', '--show-toplevel'], { conversationId }),
        git(abs, ['branch', '--show-current'], { allowFail: true, conversationId }),
        git(abs, ['rev-parse', '--short', 'HEAD'], { allowFail: true, conversationId }),
        git(abs, ['status', '--porcelain', '-uall'], { conversationId }),
        git(abs, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], {
          conversationId
        }),
        git(abs, ['worktree', 'list', '--porcelain'], { allowFail: true, conversationId })
      ])

    const toplevel = toplevelRes.stdout.trim() || abs
    const primaryPath = await resolvePrimaryWorktreePath(abs, conversationId)
    const worktrees =
      worktreeRes.code === 0
        ? parseWorktrees(abs, worktreeRes.stdout, primaryPath)
        : [
            {
              path: toplevel,
              branch: branchRes.stdout.trim() || null,
              bare: false,
              detached: !branchRes.stdout.trim(),
              isCurrent: true,
              isPrimary: true,
              label: 'Local'
            } satisfies GitWorktreeInfo
          ]

    const current = worktrees.find((w) => w.isCurrent)
    const primary = worktrees.find((w) => w.isPrimary) ?? worktrees[0]
    const projectName = basename(primary?.path || toplevel) || projectFallback
    const branch = branchRes.stdout.trim() || null
    const detached = !branch
    const branches = branchListRes.stdout
      .split('\n')
      .map((b) => b.trim())
      .filter(Boolean)

    return {
      cwd: abs,
      isRepo: true,
      toplevel,
      projectName,
      branch,
      detached,
      headShort: headRes.code === 0 ? headRes.stdout.trim() || null : null,
      worktreeLabel: current?.label ?? (primary?.path === abs ? 'Local' : basename(abs)),
      isAdditionalWorktree: !!(current && !current.isPrimary),
      worktrees,
      branches,
      changes: parsePorcelain(abs, statusRes.stdout)
    }
  } catch (err) {
    return empty({
      error: err instanceof Error ? err.message : String(err)
    })
  }
}

/**
 * Read a blob at `ref:path` as base64 (for image diffs). Missing path → missing:true.
 */
export async function getGitShowBase64(
  cwd: string,
  filePath: string,
  ref = 'HEAD',
  conversationId?: string
): Promise<GitResult<{ base64: string | null; missing: boolean }>> {
  try {
    const snap = await getGitSnapshot(cwd, conversationId)
    if (!snap.isRepo || !snap.toplevel) {
      return { ok: false, error: 'Not a git repository' }
    }
    const rel = isAbsolute(filePath)
      ? filePath.startsWith(snap.toplevel)
        ? filePath.slice(snap.toplevel.length).replace(/^[/\\]/, '')
        : filePath
      : filePath
    const spec = `${ref}:${rel.replace(/\\/g, '/')}`
    const shown = await git(snap.toplevel, ['show', spec], {
      allowFail: true,
      conversationId
    })
    if (shown.code === 0) {
      return {
        ok: true,
        data: { base64: shown.stdoutBuf.toString('base64'), missing: false }
      }
    }
    const stderr = shown.stderr
    if (
      shown.code === 128 ||
      /does not exist|exists on disk|pathspec|bad (object|revision)/i.test(stderr)
    ) {
      return { ok: true, data: { base64: null, missing: true } }
    }
    throw new Error(stderr.trim() || 'git show failed')
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function getGitDiff(
  cwd: string,
  filePath: string,
  opts?: { staged?: boolean; conversationId?: string }
): Promise<GitResult<string>> {
  try {
    const snap = await getGitSnapshot(cwd, opts?.conversationId)
    if (!snap.isRepo || !snap.toplevel) {
      return { ok: false, error: 'Not a git repository' }
    }
    const rel = isAbsolute(filePath)
      ? filePath.startsWith(snap.toplevel)
        ? filePath.slice(snap.toplevel.length).replace(/^[/\\]/, '')
        : filePath
      : filePath

    const change = snap.changes.find(
      (c) => c.path === rel || c.absolutePath === joinGitPath(snap.cwd, filePath)
    )
    if (change?.status === 'untracked' || (!opts?.staged && change?.code === '??')) {
      const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null'
      const { stdout } = await git(
        snap.toplevel,
        ['diff', '--no-index', '--', nullDevice, rel],
        { allowFail: true, conversationId: opts?.conversationId }
      )
      // git diff --no-index exits 1 when files differ
      return { ok: true, data: stdout || '(new file)' }
    }

    // Prefer unstaged; if empty and file is staged-only, fall back to cached.
    let { stdout } = await git(
      snap.toplevel,
      opts?.staged ? ['diff', '--cached', '--', rel] : ['diff', '--', rel],
      { allowFail: true, conversationId: opts?.conversationId }
    )
    if (!stdout.trim() && !opts?.staged && change?.staged) {
      const cached = await git(snap.toplevel, ['diff', '--cached', '--', rel], {
        allowFail: true,
        conversationId: opts?.conversationId
      })
      stdout = cached.stdout
    }
    return { ok: true, data: stdout || '(no textual diff)' }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function createGitBranch(
  cwd: string,
  name: string,
  opts?: { checkout?: boolean; conversationId?: string }
): Promise<GitResult<{ branch: string }>> {
  const branch = name.trim()
  if (!/^[A-Za-z0-9._/\-]+$/.test(branch) || branch.startsWith('-')) {
    return { ok: false, error: 'Invalid branch name' }
  }
  try {
    const ready = await cwdReady(cwd, opts?.conversationId)
    if (opts?.checkout !== false) {
      await git(ready.abs, ['checkout', '-b', branch], { conversationId: opts?.conversationId })
    } else {
      await git(ready.abs, ['branch', branch], { conversationId: opts?.conversationId })
    }
    return { ok: true, data: { branch } }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function checkoutGitBranch(
  cwd: string,
  name: string,
  conversationId?: string
): Promise<GitResult<{ branch: string }>> {
  const branch = name.trim()
  if (!branch) return { ok: false, error: 'Branch required' }
  try {
    const ready = await cwdReady(cwd, conversationId)
    await git(ready.abs, ['checkout', branch], { conversationId })
    return { ok: true, data: { branch } }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function createGitWorktree(
  cwd: string,
  options: { path: string; newBranch?: string; branch?: string; switchSession?: boolean },
  conversationId?: string
): Promise<GitResult<{ path: string; branch: string | null }>> {
  try {
    const snap = await getGitSnapshot(cwd, conversationId)
    if (!snap.isRepo || !snap.toplevel) {
      return { ok: false, error: 'Not a git repository' }
    }
    const primary = snap.worktrees.find((w) => w.isPrimary)?.path ?? snap.toplevel
    const target = isAbsolute(options.path)
      ? options.path
      : joinGitPath(dirname(primary), options.path)
    const host = resolveGitHost(cwd, conversationId)
    const exists =
      host.kind === 'local' ? existsSync(target) : await host.fs.exists(target)
    if (exists) {
      return { ok: false, error: `Path already exists: ${target}` }
    }

    const args = ['worktree', 'add']
    if (options.newBranch?.trim()) {
      const nb = options.newBranch.trim()
      if (!/^[A-Za-z0-9._/\-]+$/.test(nb) || nb.startsWith('-')) {
        return { ok: false, error: 'Invalid branch name' }
      }
      args.push('-b', nb, target)
      if (options.branch?.trim()) args.push(options.branch.trim())
    } else if (options.branch?.trim()) {
      args.push(target, options.branch.trim())
    } else {
      return { ok: false, error: 'Provide a branch or new branch name' }
    }

    await git(primary, args, { conversationId })
    const branch = options.newBranch?.trim() || options.branch?.trim() || null
    return { ok: true, data: { path: target, branch } }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Suggested sibling path for a new worktree. */
export function suggestWorktreePath(primaryPath: string, branchName: string): string {
  const project = basename(primaryPath)
  const slug = branchName
    .trim()
    .replace(/[^A-Za-z0-9._\-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'worktree'
  return join(dirname(primaryPath), `${project}-${slug}`)
}

/** `git init` (+ default branch) so an ordinary folder becomes a repo. */
export async function initGitRepo(
  cwd: string,
  conversationId?: string
): Promise<GitResult<GitSnapshot>> {
  try {
    const ready = await cwdReady(cwd, conversationId)
    if (!ready.ok) {
      return { ok: false, error: 'Working directory missing' }
    }
    const abs = ready.abs
    const already = await git(abs, ['rev-parse', '--is-inside-work-tree'], {
      allowFail: true,
      conversationId
    })
    if (already.code === 0 && already.stdout.trim() === 'true') {
      return { ok: true, data: await getGitSnapshot(abs, conversationId) }
    }
    const withBranch = await git(abs, ['init', '-b', 'main'], {
      allowFail: true,
      conversationId
    })
    if (withBranch.code !== 0) {
      // Older git without `init -b`
      await git(abs, ['init'], { conversationId })
      await git(abs, ['checkout', '-b', 'main'], { allowFail: true, conversationId })
    }
    return { ok: true, data: await getGitSnapshot(abs, conversationId) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
