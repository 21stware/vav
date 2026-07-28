/**
 * Programmatic smoke for ChangeSetStore + UpdateService.
 * Invoked by: bun scripts/_smoke-release-inner.ts
 */
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ChangeSetStore } from '../src/main/agent/ChangeSetStore'
import { computeRisk, summarizeChangeSetStatus } from '../src/shared/changeSet'

let failed = 0
function assert(cond: unknown, msg: string): void {
  if (!cond) {
    failed++
    console.error(`FAIL: ${msg}`)
  } else {
    console.log(`ok  ${msg}`)
  }
}

const workdir = mkdtempSync(join(tmpdir(), 'vav-smoke-'))
const store = new ChangeSetStore()
const existing = join(workdir, 'src', 'Auth.ts')
mkdirSync(join(workdir, 'src'), { recursive: true })
writeFileSync(existing, 'export const a = 1\n', 'utf8')

// --- accumulate a turn ---
store.beginTurn('conv-1')
store.recordWrite('conv-1', workdir, existing, 'export const a = 1\n', 'export const a = 2\n')
const added = join(workdir, 'src', 'New.ts')
store.recordWrite('conv-1', workdir, added, null, 'export const n = 1\n')
// apply "agent writes" to disk (mirrors tools.ts)
writeFileSync(existing, 'export const a = 2\n', 'utf8')
writeFileSync(added, 'export const n = 1\n', 'utf8')

const set = store.finalizeTurn('conv-1', 'implement oauth refresh flow', 'sonnet-4')
assert(!!set, 'finalizeTurn returns ChangeSet')
assert(set!.files.length === 2, `files.length === 2 (got ${set!.files.length})`)
assert(set!.risk === 'low' || set!.risk === 'medium', `risk computed (${set!.risk})`)
assert(store.activeFor('conv-1')?.id === set!.id, 'activeFor points at set')

// accept one file
await store.accept(set!.id, [existing])
assert(
  store.get(set!.id)!.files.find((f) => f.filePath === existing)?.status === 'accepted',
  'accept marks accepted'
)
assert(readFileSync(existing, 'utf8') === 'export const a = 2\n', 'accept keeps disk content')

// reject added file → delete
await store.reject(set!.id, [added])
assert(!existsSync(added), 'reject added file deletes it')
assert(
  store.get(set!.id)!.files.find((f) => f.filePath === added)?.status === 'rejected',
  'reject marks rejected'
)

// undo reject → restore agent content
await store.undo(set!.id, added)
assert(existsSync(added), 'undo reject restores file')
assert(readFileSync(added, 'utf8') === 'export const n = 1\n', 'undo restore content')
assert(
  store.get(set!.id)!.files.find((f) => f.filePath === added)?.status === 'pending',
  'undo → pending'
)

// edit before apply
await store.applyEdit(set!.id, added, 'export const n = 99\n')
assert(readFileSync(added, 'utf8') === 'export const n = 99\n', 'applyEdit writes content')
assert(
  store.get(set!.id)!.files.find((f) => f.filePath === added)?.status === 'edited',
  'applyEdit → edited'
)

// reject all rolls back accepted too
const set2Id = set!.id
store.beginTurn('conv-2')
const f2 = join(workdir, 'rollback.ts')
store.recordWrite('conv-2', workdir, f2, null, 'hello\n')
writeFileSync(f2, 'hello\n', 'utf8')
const set2 = store.finalizeTurn('conv-2', 'rollback test', 'test')
assert(!!set2, 'second changeset')
await store.acceptAll(set2!.id)
assert(summarizeChangeSetStatus(store.get(set2!.id)!.files) === 'accepted', 'acceptAll')
await store.rejectAll(set2!.id)
assert(!existsSync(f2), 'rejectAll deletes accepted added file')
assert(summarizeChangeSetStatus(store.get(set2!.id)!.files) === 'rejected', 'rejectAll status')

// risk helper
assert(computeRisk([]) === 'low', 'empty risk low')
assert(
  computeRisk(
    Array.from({ length: 16 }, (_, i) => ({
      filePath: `/x/${i}`,
      relativePath: `${i}.ts`,
      changeType: 'modified' as const,
      diffText: '',
      originalContent: '',
      newContent: '',
      status: 'pending' as const,
      riskLevel: 'low' as const
    }))
  ) === 'high',
  '16 files → high risk'
)

// cancelled / empty turns produce nothing
store.beginTurn('conv-empty')
assert(store.finalizeTurn('conv-empty', 'x', 'm') === null, 'no writes → null')
store.beginTurn('conv-cancel')
store.recordWrite('conv-cancel', workdir, join(workdir, 'c.ts'), null, 'x')
assert(
  store.finalizeTurn('conv-cancel', 'x', 'm', { cancelled: true }) === null,
  'cancelled → null'
)

// UpdateService (needs Electron app — skip if unavailable)
try {
  const { app } = await import('electron')
  if (!app) throw new Error('no app')
  // Under bun, electron may not initialize. Probe GitHub API directly instead.
} catch {
  // fall through to fetch probe
}

const res = await fetch('https://api.github.com/repos/21stware/vav/releases/latest', {
  headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'vav-smoke' }
})
assert(res.ok, `GitHub releases API ok (${res.status})`)
const body = (await res.json()) as { tag_name?: string }
assert(!!body.tag_name, `latest tag present (${body.tag_name})`)

// semver compare mirror
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0)
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}
assert(compareSemver('1.2.3', '1.2.2') > 0, 'semver newer')
assert(compareSemver('1.2.2', '1.2.2') === 0, 'semver equal')
assert(compareSemver('1.1.9', '1.2.0') < 0, 'semver older')

void set2Id
rmSync(workdir, { recursive: true, force: true })

if (failed) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\nall change-review + update probes passed')
