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
import { loginPath } from '../terminal/loginPath'

const execFileAsync = promisify(execFile)
const GIT_TIMEOUT_MS = 20_000
const MAX_BUFFER = 8 * 1024 * 1024

async function git(
  cwd: string,
  args: string[],
  opts?: { allowFail?: boolean }
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      env: {
        ...process.env,
        PATH: loginPath(),
        GIT_TERMINAL_PROMPT: '0',
        LANG: 'C'
      }
    })
    return { stdout: stdout.toString(), stderr: stderr.toString(), code: 0 }
  } catch (err) {
    const e = err as {
      stdout?: string | Buffer
      stderr?: string | Buffer
      code?: number | string
      message?: string
      killed?: boolean
    }
    if (opts?.allowFail) {
      return {
        stdout: e.stdout?.toString() ?? '',
        stderr: e.stderr?.toString() ?? e.message ?? '',
        code: typeof e.code === 'number' ? e.code : 1
      }
    }
    const detail = (e.stderr?.toString() || e.message || 'git failed').trim()
    throw new Error(detail.slice(0, 400))
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
      absolutePath: resolve(cwd, rel),
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
      index === 0 ||
      (!!primaryPath && resolve(path) === resolve(primaryPath))
    const isCurrent = resolve(path) === resolve(cwd)
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

async function resolvePrimaryWorktreePath(cwd: string): Promise<string | null> {
  const listed = await git(cwd, ['worktree', 'list', '--porcelain'], { allowFail: true })
  if (listed.code !== 0) return null
  const first = listed.stdout.split('\n').find((l) => l.startsWith('worktree '))
  return first ? first.slice('worktree '.length) : null
}

export async function getGitSnapshot(cwd: string): Promise<GitSnapshot> {
  const abs = resolve(cwd)
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

  if (!abs || !existsSync(abs)) {
    return empty({ error: 'Working directory missing' })
  }

  const inside = await git(abs, ['rev-parse', '--is-inside-work-tree'], { allowFail: true })
  if (inside.code !== 0 || inside.stdout.trim() !== 'true') {
    return empty()
  }

  try {
    const [toplevelRes, branchRes, headRes, statusRes, branchListRes, worktreeRes] =
      await Promise.all([
        git(abs, ['rev-parse', '--show-toplevel']),
        git(abs, ['branch', '--show-current'], { allowFail: true }),
        git(abs, ['rev-parse', '--short', 'HEAD'], { allowFail: true }),
        git(abs, ['status', '--porcelain', '-uall']),
        git(abs, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/']),
        git(abs, ['worktree', 'list', '--porcelain'], { allowFail: true })
      ])

    const toplevel = toplevelRes.stdout.trim() || abs
    const primaryPath = await resolvePrimaryWorktreePath(abs)
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
  ref = 'HEAD'
): Promise<GitResult<{ base64: string | null; missing: boolean }>> {
  try {
    const absCwd = resolve(cwd)
    const snap = await getGitSnapshot(absCwd)
    if (!snap.isRepo || !snap.toplevel) {
      return { ok: false, error: 'Not a git repository' }
    }
    const rel = isAbsolute(filePath)
      ? filePath.startsWith(snap.toplevel)
        ? filePath.slice(snap.toplevel.length).replace(/^[/\\]/, '')
        : filePath
      : filePath
    const spec = `${ref}:${rel.replace(/\\/g, '/')}`
    try {
      const { stdout } = await execFileAsync('git', ['show', spec], {
        cwd: snap.toplevel,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        encoding: 'buffer',
        env: {
          ...process.env,
          PATH: loginPath(),
          GIT_TERMINAL_PROMPT: '0',
          LANG: 'C'
        }
      })
      return {
        ok: true,
        data: { base64: Buffer.from(stdout).toString('base64'), missing: false }
      }
    } catch (err) {
      const e = err as { code?: number; stderr?: string | Buffer }
      const stderr = e.stderr?.toString() ?? ''
      if (
        e.code === 128 ||
        /does not exist|exists on disk|pathspec|bad (object|revision)/i.test(stderr)
      ) {
        return { ok: true, data: { base64: null, missing: true } }
      }
      throw err
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function getGitDiff(
  cwd: string,
  filePath: string,
  opts?: { staged?: boolean }
): Promise<GitResult<string>> {
  try {
    const absCwd = resolve(cwd)
    const snap = await getGitSnapshot(absCwd)
    if (!snap.isRepo || !snap.toplevel) {
      return { ok: false, error: 'Not a git repository' }
    }
    const rel = isAbsolute(filePath)
      ? filePath.startsWith(snap.toplevel)
        ? filePath.slice(snap.toplevel.length).replace(/^[/\\]/, '')
        : filePath
      : filePath

    const change = snap.changes.find((c) => c.path === rel || c.absolutePath === resolve(filePath))
    if (change?.status === 'untracked' || (!opts?.staged && change?.code === '??')) {
      const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null'
      const { stdout } = await git(
        snap.toplevel,
        ['diff', '--no-index', '--', nullDevice, rel],
        { allowFail: true }
      )
      // git diff --no-index exits 1 when files differ
      return { ok: true, data: stdout || '(new file)' }
    }

    // Prefer unstaged; if empty and file is staged-only, fall back to cached.
    let { stdout } = await git(
      snap.toplevel,
      opts?.staged ? ['diff', '--cached', '--', rel] : ['diff', '--', rel],
      { allowFail: true }
    )
    if (!stdout.trim() && !opts?.staged && change?.staged) {
      const cached = await git(snap.toplevel, ['diff', '--cached', '--', rel], { allowFail: true })
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
  opts?: { checkout?: boolean }
): Promise<GitResult<{ branch: string }>> {
  const branch = name.trim()
  if (!/^[A-Za-z0-9._/\-]+$/.test(branch) || branch.startsWith('-')) {
    return { ok: false, error: 'Invalid branch name' }
  }
  try {
    const abs = resolve(cwd)
    if (opts?.checkout !== false) {
      await git(abs, ['checkout', '-b', branch])
    } else {
      await git(abs, ['branch', branch])
    }
    return { ok: true, data: { branch } }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function checkoutGitBranch(
  cwd: string,
  name: string
): Promise<GitResult<{ branch: string }>> {
  const branch = name.trim()
  if (!branch) return { ok: false, error: 'Branch required' }
  try {
    await git(resolve(cwd), ['checkout', branch])
    return { ok: true, data: { branch } }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function createGitWorktree(
  cwd: string,
  options: { path: string; newBranch?: string; branch?: string; switchSession?: boolean }
): Promise<GitResult<{ path: string; branch: string | null }>> {
  try {
    const abs = resolve(cwd)
    const snap = await getGitSnapshot(abs)
    if (!snap.isRepo || !snap.toplevel) {
      return { ok: false, error: 'Not a git repository' }
    }
    const primary = snap.worktrees.find((w) => w.isPrimary)?.path ?? snap.toplevel
    const target = isAbsolute(options.path) ? options.path : resolve(dirname(primary), options.path)
    if (existsSync(target)) {
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

    await git(primary, args)
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
export async function initGitRepo(cwd: string): Promise<GitResult<GitSnapshot>> {
  try {
    const abs = resolve(cwd)
    if (!existsSync(abs)) {
      return { ok: false, error: 'Working directory missing' }
    }
    const already = await git(abs, ['rev-parse', '--is-inside-work-tree'], { allowFail: true })
    if (already.code === 0 && already.stdout.trim() === 'true') {
      return { ok: true, data: await getGitSnapshot(abs) }
    }
    const withBranch = await git(abs, ['init', '-b', 'main'], { allowFail: true })
    if (withBranch.code !== 0) {
      // Older git without `init -b`
      await git(abs, ['init'])
      await git(abs, ['checkout', '-b', 'main'], { allowFail: true })
    }
    return { ok: true, data: await getGitSnapshot(abs) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
