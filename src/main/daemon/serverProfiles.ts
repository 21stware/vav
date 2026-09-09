/**
 * Docker-style named profiles for vav-server.
 *
 * Each profile is one persisted runtime state dir under `~/.vav/servers/<name>/`
 * (identity, secret, grants, listen.json, conversations, timers…). `default` is
 * the profile the desktop app and bare `vav-server` share. Legacy `~/.vav-server`
 * and `~/.vavd` fold into `default` on first use.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { loadOrCreateIdentity, loadOrCreateSecret } from './identity.ts'
import {
  clearListenState,
  probeListenAlive,
  readListenState,
  type VavServerListenState
} from './listenState.ts'
import { findVavServerEntry, resolveNodeForVavServer, vavServerNodeArgs } from './vavServerSpawn.ts'

export const DEFAULT_PROFILE = 'default'
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export function serversRoot(home = homedir()): string {
  return join(home, '.vav', 'servers')
}

export function profileDir(name: string, home = homedir()): string {
  return join(serversRoot(home), name)
}

export function isValidProfileName(name: string): boolean {
  return NAME_RE.test(name) && name.length <= 64
}

export function assertValidProfileName(name: string): void {
  if (!isValidProfileName(name)) {
    throw new Error(`invalid profile name ${JSON.stringify(name)} — use letters, digits, dot, dash, underscore`)
  }
}

function legacyDirs(home: string): string[] {
  return [join(home, '.vav-server'), join(home, '.vavd')]
}

function looksLikeStateDir(dir: string): boolean {
  return existsSync(join(dir, 'identity.json')) || existsSync(join(dir, 'secret.json'))
}

/** Create the `default` profile, folding a legacy state dir into it once. Idempotent. */
export function ensureDefaultProfile(home = homedir()): string {
  const dir = profileDir(DEFAULT_PROFILE, home)
  if (existsSync(dir)) return dir
  mkdirSync(serversRoot(home), { recursive: true })
  const legacy = legacyDirs(home).find((candidate) => looksLikeStateDir(candidate))
  if (legacy) {
    try {
      renameSync(legacy, dir)
      return dir
    } catch {
      /* cross-device or busy — fall back to a fresh dir */
    }
  }
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Resolve the state dir for a run/admin invocation: --state wins, then --profile, then default. */
export function resolveProfileStateDir(opts: { stateFlag?: string; profile?: string; home?: string }): string {
  const home = opts.home ?? homedir()
  const stateFlag = opts.stateFlag?.trim()
  if (stateFlag) return stateFlag
  const name = opts.profile?.trim() || DEFAULT_PROFILE
  assertValidProfileName(name)
  if (name === DEFAULT_PROFILE) return ensureDefaultProfile(home)
  return profileDir(name, home)
}

export function listProfileNames(home = homedir()): string[] {
  const root = serversRoot(home)
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isValidProfileName(entry.name))
    .map((entry) => entry.name)
    .sort()
}

export type ProfileStatus = {
  name: string
  dir: string
  displayName?: string
  running: boolean
  listen: VavServerListenState | null
}

function readIdentityName(dir: string): string | undefined {
  try {
    const raw = JSON.parse(readFileSync(join(dir, 'identity.json'), 'utf8')) as { name?: unknown }
    return typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : undefined
  } catch {
    return undefined
  }
}

export async function profileStatus(name: string, home = homedir()): Promise<ProfileStatus> {
  const dir = profileDir(name, home)
  const listen = readListenState(dir)
  const running = listen ? await probeListenAlive(listen) : false
  return { name, dir, displayName: readIdentityName(dir), running, listen }
}

export async function listProfileStatuses(home = homedir()): Promise<ProfileStatus[]> {
  ensureDefaultProfile(home)
  const names = listProfileNames(home)
  if (!names.includes(DEFAULT_PROFILE)) names.unshift(DEFAULT_PROFILE)
  return Promise.all(names.map((name) => profileStatus(name, home)))
}

export function createProfile(name: string, opts: { home?: string; label?: string } = {}): ProfileStatus {
  assertValidProfileName(name)
  const home = opts.home ?? homedir()
  const dir = profileDir(name, home)
  if (existsSync(dir)) throw new Error(`profile already exists: ${name}`)
  mkdirSync(dir, { recursive: true })
  const identity = loadOrCreateIdentity(dir, opts.label || name)
  loadOrCreateSecret(dir)
  return { name, dir, displayName: identity.name, running: false, listen: null }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function stopProfile(
  name: string,
  home = homedir(),
  opts: { timeoutMs?: number } = {}
): Promise<{ stopped: boolean; pid?: number }> {
  const dir = profileDir(name, home)
  const listen = readListenState(dir)
  if (!listen?.pid) {
    clearListenState(dir)
    return { stopped: false }
  }
  const pid = listen.pid
  if (!(await probeListenAlive(listen))) {
    clearListenState(dir)
    return { stopped: false, pid }
  }
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    clearListenState(dir)
    return { stopped: false, pid }
  }
  const timeout = opts.timeoutMs ?? 5000
  const start = Date.now()
  while (Date.now() - start < timeout) {
    await delay(150)
    if (!(await probeListenAlive(listen))) {
      clearListenState(dir)
      return { stopped: true, pid }
    }
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    /* already gone */
  }
  clearListenState(dir)
  return { stopped: true, pid }
}

export async function removeProfile(name: string, opts: { home?: string; force?: boolean } = {}): Promise<void> {
  assertValidProfileName(name)
  const home = opts.home ?? homedir()
  const dir = profileDir(name, home)
  if (!existsSync(dir)) throw new Error(`no such profile: ${name}`)
  const status = await profileStatus(name, home)
  if (status.running) {
    if (!opts.force) throw new Error(`profile ${name} is running — stop it first or pass --force`)
    await stopProfile(name, home)
  }
  rmSync(dir, { recursive: true, force: true })
}

/** Spawn a profile as a detached background process; resolve once it binds (listen.json). */
export async function startProfileDetached(
  name: string,
  opts: { home?: string; cwd?: string; extraFlags?: string[]; timeoutMs?: number } = {}
): Promise<ProfileStatus> {
  assertValidProfileName(name)
  const home = opts.home ?? homedir()
  const dir = name === DEFAULT_PROFILE ? ensureDefaultProfile(home) : profileDir(name, home)
  if (!existsSync(dir)) throw new Error(`no such profile: ${name} (run: vav-server create ${name})`)
  const existing = readListenState(dir)
  if (existing && (await probeListenAlive(existing))) {
    return { name, dir, displayName: readIdentityName(dir), running: true, listen: existing }
  }
  const cwd = opts.cwd ?? process.cwd()
  const entry = findVavServerEntry(cwd)
  if (!entry) throw new Error('vav-server entry not found — run from the repo or an installed build')
  const flags = ['--state', dir, ...(opts.extraFlags ?? [])]
  const args = vavServerNodeArgs(entry, flags)
  const node = resolveNodeForVavServer()
  const logFile = join(dir, 'server.log')
  const out = openSync(logFile, 'a')
  const child = spawn(node.cmd, args, {
    cwd: entry.root,
    detached: true,
    stdio: ['ignore', out, out],
    env: { ...process.env, ...(node.asNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}) }
  })
  child.unref()
  const timeout = opts.timeoutMs ?? 12_000
  const start = Date.now()
  while (Date.now() - start < timeout) {
    await delay(200)
    const listen = readListenState(dir)
    if (listen && (await probeListenAlive(listen))) {
      return { name, dir, displayName: readIdentityName(dir), running: true, listen }
    }
    if (child.exitCode != null) throw new Error(`vav-server exited early (code ${child.exitCode}); see ${logFile}`)
  }
  throw new Error(`vav-server did not bind within ${timeout}ms; see ${logFile}`)
}
