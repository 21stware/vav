/**
 * Discover click-to-run commands from a workspace root (package.json, Cargo.toml,
 * go.mod, pyproject, Makefile). No filesystem — callers pass listing + file text.
 *
 * Node runner (npm vs bun vs pnpm vs yarn):
 *   1. `package.json` `packageManager` (Corepack) wins.
 *   2. Lockfiles next: bun.lock / bun.lockb, then pnpm, yarn, npm.
 *   3. `bunfig.toml` only if there is no lockfile — it is bun's runtime config,
 *      not an install lock (this repo has bunfig.toml + package-lock.json → npm).
 *   Script bodies that happen to call `bun` do not change the runner: `npm run
 *   dev:vav-server` still goes through npm, which then execs bun.
 */

import { stripJsonc } from './cloudflareConfig.ts'

export type NodePackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'
export type PythonRunner = 'uv' | 'poetry' | 'pipenv' | 'python'
export type WorkspaceRunKind = 'node' | 'python' | 'go' | 'rust' | 'make'

export type WorkspaceRunScript = {
  id: string
  kind: WorkspaceRunKind
  label: string
  command: string
  /** Set on node scripts so the menu can say "bun scripts". */
  runner?: NodePackageManager
}

export type WorkspaceDirEntry = {
  name: string
  path: string
  isDirectory: boolean
}

export type WorkspaceRunFs = {
  list(path: string): Promise<WorkspaceDirEntry[]>
  readText(path: string): Promise<string | null>
}

export type WorkspaceRunManifest = {
  names: string[]
  packageJson?: string | null
  cargoToml?: string | null
  goMod?: string | null
  pyprojectToml?: string | null
  makefile?: string | null
  goCmdNames?: string[]
  hasGoMain?: boolean
}

const NODE_SCRIPT_PIN = [
  'dev',
  'start',
  'test',
  'build',
  'lint',
  'format',
  'preview',
  'check',
  'typecheck'
]

const NPM_LIFECYCLE = new Set([
  'preinstall',
  'install',
  'postinstall',
  'prepublish',
  'prepublishonly',
  'publish',
  'postpublish',
  'prepack',
  'pack',
  'postpack',
  'prepare',
  'preprepare',
  'postprepare',
  'dependencies',
  'optionaldependencies'
])

const MAX_NODE_SCRIPTS = 40
const MAX_MAKE_TARGETS = 20

export function nameSet(names: string[]): Set<string> {
  return new Set(names.map((n) => n.toLowerCase()))
}

export function hasName(names: Set<string>, ...want: string[]): boolean {
  return want.some((n) => names.has(n.toLowerCase()))
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function parsePackageJson(source: string | null | undefined): Record<string, unknown> | null {
  if (!source?.trim()) return null
  try {
    return recordOf(JSON.parse(source)) ?? recordOf(JSON.parse(stripJsonc(source)))
  } catch {
    try {
      return recordOf(JSON.parse(stripJsonc(source)))
    } catch {
      return null
    }
  }
}

function packageManagerField(pkg: Record<string, unknown> | null): NodePackageManager | null {
  const raw = pkg && typeof pkg.packageManager === 'string' ? pkg.packageManager : ''
  const name = raw.split('@')[0]?.trim().toLowerCase()
  if (name === 'bun' || name === 'pnpm' || name === 'yarn' || name === 'npm') return name
  return null
}

/**
 * Pick the installer that should invoke `package.json` scripts.
 * Lockfiles beat `bunfig.toml`; Corepack beats lockfiles.
 */
export function detectNodePackageManager(input: {
  names: string[]
  packageJson?: string | null
}): NodePackageManager {
  const names = nameSet(input.names)
  const pkg = parsePackageJson(input.packageJson)
  const field = packageManagerField(pkg)
  if (field) return field

  if (hasName(names, 'bun.lock', 'bun.lockb')) return 'bun'
  if (hasName(names, 'pnpm-lock.yaml', 'pnpm-workspace.yaml')) return 'pnpm'
  if (hasName(names, 'yarn.lock', '.yarnrc.yml')) return 'yarn'
  if (hasName(names, 'package-lock.json', 'npm-shrinkwrap.json')) return 'npm'
  if (hasName(names, 'bunfig.toml')) return 'bun'
  return 'npm'
}

export function detectPythonRunner(input: {
  names: string[]
  pyprojectToml?: string | null
}): PythonRunner {
  const names = nameSet(input.names)
  const py = input.pyprojectToml ?? ''
  if (hasName(names, 'uv.lock') || /\[tool\.uv\b/i.test(py)) return 'uv'
  if (hasName(names, 'poetry.lock') || /\[tool\.poetry\b/i.test(py)) return 'poetry'
  if (hasName(names, 'pipfile', 'pipfile.lock')) return 'pipenv'
  return 'python'
}

export function shellSingleArg(value: string): string {
  if (/^[A-Za-z0-9_.:/=@+-]+$/.test(value)) return value
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function nodeRunCommand(pm: NodePackageManager, script: string): string {
  const name = shellSingleArg(script)
  if (pm === 'bun') return `bun run ${name}`
  if (pm === 'pnpm') return `pnpm run ${name}`
  if (pm === 'yarn') return `yarn ${name}`
  return `npm run ${name}`
}

export function pythonPrefix(runner: PythonRunner): string {
  if (runner === 'uv') return 'uv run '
  if (runner === 'poetry') return 'poetry run '
  if (runner === 'pipenv') return 'pipenv run '
  return ''
}

export function pythonBin(runner: PythonRunner): string {
  return runner === 'python' ? 'python3' : `${pythonPrefix(runner)}python`
}

function isHiddenNodeScript(name: string, all: Set<string>): boolean {
  if (!name || name.startsWith('_')) return true
  const lower = name.toLowerCase()
  if (NPM_LIFECYCLE.has(lower)) return true
  if (/^pre.+/.test(lower) && all.has(lower.slice(3))) return true
  if (/^post.+/.test(lower) && all.has(lower.slice(4))) return true
  return false
}

function sortNodeScripts(names: string[]): string[] {
  const pin = new Map(NODE_SCRIPT_PIN.map((n, i) => [n, i]))
  return [...names].sort((a, b) => {
    const pa = pin.get(a)
    const pb = pin.get(b)
    if (pa != null && pb != null) return pa - pb
    if (pa != null) return -1
    if (pb != null) return 1
    return a.localeCompare(b)
  })
}

export function collectNodeScripts(
  packageJson: string | null | undefined,
  pm: NodePackageManager
): WorkspaceRunScript[] {
  const pkg = parsePackageJson(packageJson)
  const scripts = pkg ? recordOf(pkg.scripts) : null
  if (!scripts) return []
  const names = Object.entries(scripts)
    .filter(([, value]) => typeof value === 'string')
    .map(([name]) => name)
  const visible = new Set(names.map((n) => n.toLowerCase()))
  const picked = sortNodeScripts(names.filter((n) => !isHiddenNodeScript(n, visible))).slice(
    0,
    MAX_NODE_SCRIPTS
  )
  return picked.map((name) => ({
    id: `node:${name}`,
    kind: 'node',
    label: name,
    command: nodeRunCommand(pm, name),
    runner: pm
  }))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function tomlSectionBody(source: string, section: string): string | null {
  const re = new RegExp(`^\\[${escapeRegExp(section)}\\]\\s*$`, 'im')
  const m = re.exec(source)
  if (!m) return null
  const rest = source.slice(m.index + m[0].length)
  const end = rest.search(/\n\[/)
  return end === -1 ? rest : rest.slice(0, end)
}

function tomlTableKeys(source: string, section: string): string[] {
  const body = tomlSectionBody(source, section)
  if (!body) return []
  const keys: string[] = []
  for (const line of body.split('\n')) {
    const kv = /^\s*([A-Za-z0-9_-]+)\s*=\s*/.exec(line)
    if (kv) keys.push(kv[1]!)
  }
  return keys
}

function tomlTableArrays(source: string, table: string): Record<string, string>[] {
  const rows: Record<string, string>[] = []
  const re = new RegExp(`^\\[\\[${table}\\]\\]\\s*$`, 'gim')
  let match: RegExpExecArray | null
  while ((match = re.exec(source))) {
    const start = match.index + match[0].length
    const rest = source.slice(start)
    const end = rest.search(/\n\[/)
    const body = end === -1 ? rest : rest.slice(0, end)
    const rec: Record<string, string> = {}
    for (const line of body.split('\n')) {
      const kv = /^\s*([A-Za-z0-9_]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(line)
      if (!kv) continue
      rec[kv[1]!] = kv[2] ?? kv[3] ?? kv[4] ?? ''
    }
    rows.push(rec)
  }
  return rows
}

export function collectPythonScripts(input: {
  names: string[]
  pyprojectToml?: string | null
}): WorkspaceRunScript[] {
  const names = nameSet(input.names)
  const runner = detectPythonRunner(input)
  const prefix = pythonPrefix(runner)
  const py = pythonBin(runner)
  const out: WorkspaceRunScript[] = []
  const push = (id: string, label: string, command: string): void => {
    if (out.some((s) => s.command === command)) return
    out.push({ id, kind: 'python', label, command })
  }

  if (hasName(names, 'manage.py')) {
    push('python:manage-runserver', 'manage.py runserver', `${py} manage.py runserver`)
  }
  if (hasName(names, 'main.py')) push('python:main', 'main.py', `${py} main.py`)
  if (hasName(names, 'app.py')) push('python:app', 'app.py', `${py} app.py`)

  const pyproject = input.pyprojectToml ?? ''
  const scriptNames = [
    ...tomlTableKeys(pyproject, 'project.scripts'),
    ...tomlTableKeys(pyproject, 'tool.poetry.scripts'),
    ...tomlTableKeys(pyproject, 'tool.uv.scripts')
  ]
  for (const name of scriptNames) {
    const cmd = prefix ? `${prefix.trim()} ${shellSingleArg(name)}` : shellSingleArg(name)
    push(`python:script:${name}`, name, cmd)
  }

  const pythonProject =
    !!input.pyprojectToml?.trim() ||
    hasName(names, 'uv.lock', 'poetry.lock', 'pipfile', 'pipfile.lock', 'requirements.txt', 'manage.py')
  const hasPytest =
    hasName(names, 'pytest.ini', 'conftest.py') ||
    /\[tool\.pytest\b/i.test(pyproject) ||
    (pythonProject && [...names].some((n) => n === 'tests' || n === 'test'))
  if (hasPytest) {
    push(
      'python:pytest',
      'pytest',
      prefix ? `${prefix}pytest`.replace(/\s+/g, ' ') : 'python3 -m pytest'
    )
  }
  return out
}

export function collectGoScripts(input: {
  goMod?: string | null
  goCmdNames?: string[]
  hasGoMain?: boolean
}): WorkspaceRunScript[] {
  if (!input.goMod?.trim()) return []
  const out: WorkspaceRunScript[] = []
  const cmds = (input.goCmdNames ?? []).filter(Boolean)
  if (input.hasGoMain) {
    out.push({ id: 'go:run', kind: 'go', label: 'go run .', command: 'go run .' })
  }
  for (const name of cmds) {
    const rel = `./cmd/${name}`
    out.push({
      id: `go:cmd:${name}`,
      kind: 'go',
      label: `go run ${rel}`,
      command: `go run ${shellSingleArg(rel)}`
    })
  }
  if (!input.hasGoMain && cmds.length === 0) {
    out.push({ id: 'go:run', kind: 'go', label: 'go run .', command: 'go run .' })
  }
  out.push(
    { id: 'go:test', kind: 'go', label: 'go test ./...', command: 'go test ./...' },
    { id: 'go:build', kind: 'go', label: 'go build .', command: 'go build .' }
  )
  return out
}

export function collectRustScripts(cargoToml: string | null | undefined): WorkspaceRunScript[] {
  if (!cargoToml?.trim()) return []
  const bins = tomlTableArrays(cargoToml, 'bin')
    .map((row) => row.name?.trim())
    .filter((name): name is string => !!name)
  const out: WorkspaceRunScript[] = [
    { id: 'rust:run', kind: 'rust', label: 'cargo run', command: 'cargo run' }
  ]
  for (const name of bins) {
    out.push({
      id: `rust:bin:${name}`,
      kind: 'rust',
      label: `cargo run --bin ${name}`,
      command: `cargo run --bin ${shellSingleArg(name)}`
    })
  }
  out.push(
    { id: 'rust:test', kind: 'rust', label: 'cargo test', command: 'cargo test' },
    { id: 'rust:build', kind: 'rust', label: 'cargo build', command: 'cargo build' },
    { id: 'rust:check', kind: 'rust', label: 'cargo check', command: 'cargo check' }
  )
  return out
}

export function collectMakeScripts(makefile: string | null | undefined): WorkspaceRunScript[] {
  if (!makefile?.trim()) return []
  const seen = new Set<string>()
  const targets: string[] = []
  for (const line of makefile.split('\n')) {
    if (/^\s/.test(line) || line.startsWith('#') || line.startsWith('\t')) continue
    const m = /^([A-Za-z][A-Za-z0-9_-]*):/.exec(line)
    if (!m) continue
    const name = m[1]!
    if (seen.has(name)) continue
    seen.add(name)
    targets.push(name)
    if (targets.length >= MAX_MAKE_TARGETS) break
  }
  return targets.map((name) => ({
    id: `make:${name}`,
    kind: 'make',
    label: `make ${name}`,
    command: `make ${shellSingleArg(name)}`
  }))
}

export function collectWorkspaceRunScripts(manifest: WorkspaceRunManifest): WorkspaceRunScript[] {
  const names = manifest.names
  const hasPkg = hasName(nameSet(names), 'package.json') || !!manifest.packageJson?.trim()
  const pm = hasPkg ? detectNodePackageManager(manifest) : null
  const scripts: WorkspaceRunScript[] = []
  if (hasPkg && pm) scripts.push(...collectNodeScripts(manifest.packageJson, pm))
  scripts.push(...collectPythonScripts(manifest))
  scripts.push(...collectGoScripts(manifest))
  scripts.push(...collectRustScripts(manifest.cargoToml))
  scripts.push(...collectMakeScripts(manifest.makefile))
  return scripts
}

function findEntry(entries: WorkspaceDirEntry[], ...want: string[]): WorkspaceDirEntry | undefined {
  const lower = new Set(want.map((n) => n.toLowerCase()))
  return entries.find((e) => lower.has(e.name.toLowerCase()))
}

export async function scanWorkspaceRunScripts(
  root: string,
  fs: WorkspaceRunFs
): Promise<{ scripts: WorkspaceRunScript[]; packageManager: NodePackageManager | null }> {
  const trimmed = root.trim()
  if (!trimmed) return { scripts: [], packageManager: null }

  const entries = await fs.list(trimmed)
  const names = entries.map((e) => e.name)
  const readNamed = async (...want: string[]): Promise<string | null> => {
    const entry = findEntry(entries, ...want)
    if (!entry || entry.isDirectory) return null
    return fs.readText(entry.path)
  }

  const cmdDir = entries.find((e) => e.isDirectory && e.name.toLowerCase() === 'cmd')
  const goCmdNames: string[] = []
  if (cmdDir?.isDirectory) {
    const kids = await fs.list(cmdDir.path)
    for (const kid of kids) {
      if (kid.isDirectory && !kid.name.startsWith('.')) goCmdNames.push(kid.name)
    }
  }

  const manifest: WorkspaceRunManifest = {
    names,
    packageJson: await readNamed('package.json'),
    cargoToml: await readNamed('Cargo.toml'),
    goMod: await readNamed('go.mod'),
    pyprojectToml: await readNamed('pyproject.toml'),
    makefile: await readNamed('Makefile', 'makefile', 'GNUmakefile'),
    goCmdNames,
    hasGoMain: !!findEntry(entries, 'main.go')
  }
  const hasPkg = hasName(nameSet(names), 'package.json') || !!manifest.packageJson?.trim()
  return {
    scripts: collectWorkspaceRunScripts(manifest),
    packageManager: hasPkg ? detectNodePackageManager(manifest) : null
  }
}

export function asSingleShellLine(command: string): string {
  return command.replace(/[\r\n]+/g, ' ').trim()
}
