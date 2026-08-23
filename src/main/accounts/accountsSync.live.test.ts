import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { AccountStore } from '../store/AccountStore.ts'
import { accountRowUsage, agentIdOf, oauthIdentityKey } from '../../shared/accounts.ts'
import { windowsFromCursorPeriodPayload, windowsFromGrokBillingPayload } from '../../shared/quotaWindows.ts'

const execFileAsync = promisify(execFile)
const REAL = join(homedir(), 'Library/Application Support/vav-dev/accounts.json')

describe('accounts sync (real store + live quota)', () => {
  it('collapses duplicate OAuth identities and labels quota when windows exist', () => {
    if (!existsSync(REAL)) return
    const dir = mkdtempSync(join(tmpdir(), 'vav-accounts-live-'))
    try {
      cpSync(REAL, join(dir, 'accounts.json'))
      const store = new AccountStore(dir)
      store.coalesceOAuthIdentities()
      const workspaces = [...new Set(store.load().map((row) => row.workspaceKey))]
      assert.ok(workspaces.length > 0)
      for (const workspace of workspaces) {
        const oauthKeys = store
          .listVisible(workspace)
          .filter((row) => row.kind === 'oauth')
          .map((row) => oauthIdentityKey(row))
        assert.equal(oauthKeys.length, new Set(oauthKeys).size, `duplicate identity in ${workspace}`)
      }
      const latest = [...workspaces].sort().at(-1) ?? workspaces[0]!
      for (const row of store.listVisible(latest)) {
        if (agentIdOf(row) !== 'grok' && agentIdOf(row) !== 'cursor') continue
        const usage = accountRowUsage({
          kind: row.kind,
          keyStatus: row.keyStatus,
          oauthSignedIn: row.keyStatus === 'ok',
          oauthExpired: row.oauthExpired === true,
          quotaPercent: row.keyStatus === 'ok' ? 39 : null,
          quotaStatus: row.keyStatus === 'ok' ? 'ready' : 'none',
          monthTokens: 0,
          refreshing: false
        })
        if (row.keyStatus === 'ok') {
          assert.equal(usage?.kind, 'percent')
        } else if (row.oauthExpired) {
          assert.equal(usage?.kind, 'signedOut')
        } else {
          assert.notEqual(usage?.kind, 'signedOut')
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fetches Grok and Cursor quota without hanging', async () => {
    const grok = await fetchGrokQuota()
    const cursor = await fetchCursorQuota()
    if (grok.windows?.[0]) {
      const pct = grok.windows[0].usedPercent
      const chip = accountRowUsage({
        kind: 'oauth',
        keyStatus: 'ok',
        oauthSignedIn: true,
        quotaPercent: pct,
        quotaStatus: 'ready',
        monthTokens: 0,
        refreshing: false
      })
      assert.equal(chip?.kind, pct >= 100 ? 'capped' : 'percent')
    }
    assert.equal(grok.hung, false)
    assert.equal(cursor.hung, false)
  })
})

async function fetchGrokQuota(): Promise<{
  hung: boolean
  windows: ReturnType<typeof windowsFromGrokBillingPayload> | null
}> {
  const auth = join(homedir(), '.grok', 'auth.json')
  if (!existsSync(auth)) return { hung: false, windows: null }
  try {
    const raw = JSON.parse(readFileSync(auth, 'utf8')) as Record<string, unknown>
    let token: string | null = null
    for (const value of Object.values(raw)) {
      if (!value || typeof value !== 'object') continue
      const rec = value as Record<string, unknown>
      if (typeof rec.key === 'string' && rec.key) {
        token = rec.key
        break
      }
    }
    if (!token) return { hung: false, windows: null }
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 8_000)
    const res = await fetch('https://cli-chat-proxy.grok.com/v1/billing?format=credits', {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-XAI-Token-Auth': 'xai-grok-cli',
        Accept: 'application/json'
      },
      signal: ac.signal
    }).finally(() => clearTimeout(timer))
    if (!res.ok) return { hung: false, windows: [] }
    return { hung: false, windows: windowsFromGrokBillingPayload(await res.json()) }
  } catch (err) {
    const hung = err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')
    return { hung, windows: hung ? null : [] }
  }
}

async function fetchCursorQuota(): Promise<{
  hung: boolean
  windows: ReturnType<typeof windowsFromCursorPeriodPayload> | null
}> {
  try {
    const { stdout } = await execFileAsync(
      'security',
      ['find-generic-password', '-s', 'cursor-access-token', '-w'],
      { timeout: 3_000, maxBuffer: 64 * 1024 }
    )
    const token = stdout.toString().trim()
    if (!token) return { hung: false, windows: null }
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 8_000)
    const res = await fetch(
      'https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'cursor-agent'
        },
        body: '{}',
        signal: ac.signal
      }
    ).finally(() => clearTimeout(timer))
    if (!res.ok) return { hung: false, windows: [] }
    return { hung: false, windows: windowsFromCursorPeriodPayload(await res.json()) }
  } catch (err) {
    const hung = err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')
    return { hung, windows: hung ? null : [] }
  }
}
