import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { basename, dirname, isAbsolute, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import type {
  GitBranchEntry,
  GitBranchesPage,
  GitChangeEntry,
  GitCommitEntry,
  GitFileStatus,
  GitLogPage,
  GitResult,
  GitSnapshot,
  GitStashEntry,
  GitStashesPage,
  GitWorktreeInfo
} from '@shared/git'
import { suggestWorktreePath } from '@shared/git'
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

const GIT_OVERRIDE_KEYS = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_CEILING_DIRECTORIES',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR'
] as const

async function gitEnv(kind: 'local' | 'remote'): Promise<NodeJS.ProcessEnv> {
  const extra = {
    GIT_TERMINAL_PROMPT: '0',
    LANG: 'C'
  }
  const env: NodeJS.ProcessEnv =
    kind === 'remote'
      ? { ...extra }
      : {
          ...process.env,
          PATH: (await import('../terminal/loginPath.ts')).loginPath(),
          ...extra
        }
  for (const key of GIT_OVERRIDE_KEYS) delete env[key]
  return env
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

function isGitBranchName(value: string): boolean {
  return /^[A-Za-z0-9._/\-]+$/.test(value) && !value.startsWith('-') && !value.includes('..')
}

function isGitRefArg(value: string): boolean {
  if (!value || value.length > 256 || value.startsWith('-') || value.includes('..')) return false
  return /^[A-Za-z0-9._/@{}+\-^~]+$/.test(value)
}

export async function createGitBranch(
  cwd: string,
  name: string,
  opts?: { checkout?: boolean; startPoint?: string; conversationId?: string }
): Promise<GitResult<{ branch: string }>> {
  const branch = name.trim()
  if (!isGitBranchName(branch)) {
    return { ok: false, error: 'Invalid branch name' }
  }
  const start = opts?.startPoint?.trim()
  if (start && !isGitRefArg(start)) {
    return { ok: false, error: 'Invalid start point' }
  }
  try {
    const ready = await cwdReady(cwd, opts?.conversationId)
    const extra = start ? [start] : []
    if (opts?.checkout !== false) {
      await git(ready.abs, ['checkout', '-b', branch, ...extra], {
        conversationId: opts?.conversationId
      })
    } else {
      await git(ready.abs, ['branch', branch, ...extra], { conversationId: opts?.conversationId })
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
  if (!isGitRefArg(branch)) return { ok: false, error: 'Invalid branch name' }
  try {
    const ready = await cwdReady(cwd, conversationId)
    const heads = await git(ready.abs, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], {
      allowFail: true,
      conversationId
    })
    if (heads.code === 0) {
      await git(ready.abs, ['checkout', branch], { conversationId })
      return { ok: true, data: { branch } }
    }
    const remotes = await git(
      ready.abs,
      ['show-ref', '--verify', '--quiet', `refs/remotes/${branch}`],
      { allowFail: true, conversationId }
    )
    if (remotes.code === 0) {
      const short = branch.includes('/') ? branch.slice(branch.indexOf('/') + 1) : branch
      const local = await git(ready.abs, ['show-ref', '--verify', '--quiet', `refs/heads/${short}`], {
        allowFail: true,
        conversationId
      })
      if (local.code === 0) {
        await git(ready.abs, ['checkout', short], { conversationId })
        return { ok: true, data: { branch: short } }
      }
      await git(ready.abs, ['checkout', '--track', branch], { conversationId })
      return { ok: true, data: { branch: short } }
    }
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

export { suggestWorktreePath }

const LOG_LIMIT = 200
const LOG_FORMAT = '%H%x00%h%x00%ct%x00%an%x00%s'
const BRANCH_FORMAT =
  '%(refname)%00%(refname:short)%00%(objectname)%00%(objectname:short)%00%(committerdate:unix)%00%(subject)%00%(upstream:short)%00%(upstream:track)%00%(HEAD)%00%(symref)'
const STASH_FORMAT = '%gd%x00%H%x00%h%x00%ct%x00%s'

function parseTrack(raw: string): { ahead: number; behind: number; gone: boolean } {
  return {
    ahead: Number(/ahead (\d+)/.exec(raw)?.[1] ?? 0) || 0,
    behind: Number(/behind (\d+)/.exec(raw)?.[1] ?? 0) || 0,
    gone: /\[gone\]/.test(raw)
  }
}

function parseLog(text: string): GitCommitEntry[] {
  const out: GitCommitEntry[] = []
  for (const line of text.split('\n')) {
    if (!line) continue
    const [sha, shortSha, date, author, subject] = line.split('\0')
    if (!sha || !shortSha) continue
    out.push({
      sha,
      shortSha,
      subject: subject ?? '',
      author: author ?? '',
      date: (Number(date) || 0) * 1000
    })
  }
  return out
}

function parseBranches(text: string): GitBranchesPage {
  const local: GitBranchEntry[] = []
  const remote: GitBranchEntry[] = []
  for (const line of text.split('\n')) {
    if (!line) continue
    const [
      refname,
      short,
      sha,
      shortSha,
      date,
      subject,
      upstream,
      track,
      head,
      symref
    ] = line.split('\0')
    if (!refname || !short || !sha) continue
    if (symref) continue
    const isRemote = refname.startsWith('refs/remotes/')
    const isLocal = refname.startsWith('refs/heads/')
    if (!isRemote && !isLocal) continue
    let remoteName: string | null = null
    let name = short
    if (isRemote) {
      const rest = refname.slice('refs/remotes/'.length)
      const slash = rest.indexOf('/')
      remoteName = slash >= 0 ? rest.slice(0, slash) : rest
      name = slash >= 0 ? rest.slice(slash + 1) : rest
      if (name === 'HEAD') continue
    }
    const { ahead, behind, gone } = parseTrack(track ?? '')
    const entry: GitBranchEntry = {
      name,
      fullName: short,
      sha,
      shortSha: shortSha || sha.slice(0, 7),
      subject: subject ?? '',
      date: (Number(date) || 0) * 1000,
      current: head === '*',
      upstream: upstream || null,
      ahead,
      behind,
      gone,
      remote: remoteName
    }
    if (isRemote) remote.push(entry)
    else local.push(entry)
  }
  return { local, remote }
}

function parseStashes(text: string): GitStashEntry[] {
  const out: GitStashEntry[] = []
  for (const line of text.split('\n')) {
    if (!line) continue
    const [selector, sha, shortSha, date, subject] = line.split('\0')
    if (!selector || !sha) continue
    const index = Number(/^stash@\{(\d+)\}$/.exec(selector.trim())?.[1] ?? -1)
    if (index < 0) continue
    out.push({
      index,
      selector: selector.trim(),
      sha,
      shortSha: shortSha || sha.slice(0, 7),
      subject: subject ?? '',
      date: (Number(date) || 0) * 1000
    })
  }
  return out
}

async function requireRepo(
  cwd: string,
  conversationId?: string
): Promise<GitResult<{ abs: string }>> {
  const snap = await getGitSnapshot(cwd, conversationId)
  if (!snap.isRepo) {
    return { ok: false, error: snap.error || 'Not a git repository' }
  }
  return { ok: true, data: { abs: snap.cwd } }
}

export async function listGitLog(
  cwd: string,
  opts?: { limit?: number; conversationId?: string }
): Promise<GitResult<GitLogPage>> {
  try {
    const ready = await requireRepo(cwd, opts?.conversationId)
    if (!ready.ok) return ready
    const limit = Math.min(Math.max(opts?.limit ?? LOG_LIMIT, 1), 500)
    const listed = await git(ready.data.abs, ['log', `-n${limit}`, `--format=${LOG_FORMAT}`], {
      allowFail: true,
      conversationId: opts?.conversationId
    })
    if (listed.code !== 0) {
      if (/does not have any commits|bad default revision|unknown revision/i.test(listed.stderr)) {
        return { ok: true, data: { commits: [] } }
      }
      return { ok: false, error: listed.stderr.trim() || 'git log failed' }
    }
    return { ok: true, data: { commits: parseLog(listed.stdout) } }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function listGitBranches(
  cwd: string,
  conversationId?: string
): Promise<GitResult<GitBranchesPage>> {
  try {
    const ready = await requireRepo(cwd, conversationId)
    if (!ready.ok) return ready
    const listed = await git(
      ready.data.abs,
      ['for-each-ref', `--format=${BRANCH_FORMAT}`, '--sort=-committerdate', 'refs/heads', 'refs/remotes'],
      { conversationId }
    )
    return { ok: true, data: parseBranches(listed.stdout) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function listGitStashes(
  cwd: string,
  conversationId?: string
): Promise<GitResult<GitStashesPage>> {
  try {
    const ready = await requireRepo(cwd, conversationId)
    if (!ready.ok) return ready
    const listed = await git(ready.data.abs, ['stash', 'list', `--format=${STASH_FORMAT}`], {
      allowFail: true,
      conversationId
    })
    if (listed.code !== 0) {
      return { ok: false, error: listed.stderr.trim() || 'git stash list failed' }
    }
    return { ok: true, data: { stashes: parseStashes(listed.stdout) } }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function getGitPatch(
  cwd: string,
  spec: string,
  conversationId?: string
): Promise<GitResult<string>> {
  const ref = spec.trim()
  if (!isGitRefArg(ref)) return { ok: false, error: 'Invalid revision' }
  try {
    const ready = await requireRepo(cwd, conversationId)
    if (!ready.ok) return ready
    const shown = await git(ready.data.abs, ['show', '--format=medium', '--stat', '-p', ref], {
      allowFail: true,
      conversationId
    })
    if (shown.code !== 0) {
      return { ok: false, error: shown.stderr.trim() || 'git show failed' }
    }
    return { ok: true, data: shown.stdout || '(empty)' }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function deleteGitBranch(
  cwd: string,
  name: string,
  conversationId?: string
): Promise<GitResult<{ branch: string }>> {
  const branch = name.trim()
  if (!isGitBranchName(branch)) return { ok: false, error: 'Invalid branch name' }
  try {
    const snap = await getGitSnapshot(cwd, conversationId)
    if (!snap.isRepo) return { ok: false, error: snap.error || 'Not a git repository' }
    if (snap.branch === branch) {
      return { ok: false, error: 'Cannot delete the current branch' }
    }
    await git(snap.cwd, ['branch', '-d', branch], { conversationId })
    return { ok: true, data: { branch } }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function stashGitPush(
  cwd: string,
  opts?: { message?: string; conversationId?: string }
): Promise<GitResult<{ selector: string | null }>> {
  try {
    const ready = await requireRepo(cwd, opts?.conversationId)
    if (!ready.ok) return ready
    const message = opts?.message?.trim()
    const args = ['stash', 'push']
    if (message) args.push('-m', message)
    await git(ready.data.abs, args, { conversationId: opts?.conversationId })
    const listed = await listGitStashes(cwd, opts?.conversationId)
    const selector = listed.ok ? listed.data.stashes[0]?.selector ?? null : null
    return { ok: true, data: { selector } }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function stashGitApply(
  cwd: string,
  index: number,
  opts?: { pop?: boolean; conversationId?: string }
): Promise<GitResult<{ selector: string }>> {
  if (!Number.isInteger(index) || index < 0) {
    return { ok: false, error: 'Invalid stash' }
  }
  const selector = `stash@{${index}}`
  try {
    const ready = await requireRepo(cwd, opts?.conversationId)
    if (!ready.ok) return ready
    await git(ready.data.abs, ['stash', opts?.pop ? 'pop' : 'apply', selector], {
      conversationId: opts?.conversationId
    })
    return { ok: true, data: { selector } }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function stashGitDrop(
  cwd: string,
  index: number,
  conversationId?: string
): Promise<GitResult<{ selector: string }>> {
  if (!Number.isInteger(index) || index < 0) {
    return { ok: false, error: 'Invalid stash' }
  }
  const selector = `stash@{${index}}`
  try {
    const ready = await requireRepo(cwd, conversationId)
    if (!ready.ok) return ready
    await git(ready.data.abs, ['stash', 'drop', selector], { conversationId })
    return { ok: true, data: { selector } }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
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
