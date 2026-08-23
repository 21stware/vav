import { execFile } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { promisify } from 'node:util'
import type { CliHostKind } from '../../../shared/cliHost.ts'
import type { HostCredentialAdapter, HostCredentialSnapshot } from './adapter.ts'

const execFileAsync = promisify(execFile)
const KEYCHAIN_TIMEOUT_MS = 12_000

export type KeychainRun = (args: string[]) => Promise<string>

export async function defaultKeychainRun(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('security', args, {
    timeout: KEYCHAIN_TIMEOUT_MS,
    maxBuffer: 1024 * 1024
  })
  return stdout.toString()
}

function accountFromFindOutput(raw: string): string | null {
  const match = raw.match(/"acct"<blob>="([^"]*)"/)
  return match?.[1] || null
}

export function makeKeychainAdapter(input: {
  host: CliHostKind
  service: () => string
  account?: () => string | null
  parseIdentity: (payload: string) => string | null
  parseExpiry: (payload: string) => number | null
  fileFallback?: () => string | null
  run?: KeychainRun
}): HostCredentialAdapter {
  const run = input.run ?? defaultKeychainRun

  async function resolveAccount(): Promise<string> {
    const configured = input.account?.()?.trim()
    if (configured) return configured
    try {
      const meta = await run(['find-generic-password', '-s', input.service()])
      const acct = accountFromFindOutput(meta)
      if (acct) return acct
    } catch {
      // empty slot
    }
    return process.env.USER || process.env.USERNAME || 'user'
  }

  async function readKeychain(): Promise<string | null> {
    if (process.platform !== 'darwin' && !input.run) return null
    const args = ['find-generic-password', '-s', input.service(), '-w']
    const configured = input.account?.()?.trim()
    if (configured) args.splice(3, 0, '-a', configured)
    try {
      const raw = (await run(args)).trim()
      return raw || null
    } catch {
      return null
    }
  }

  function readFileSlot(): string | null {
    const path = input.fileFallback?.()
    if (!path) return null
    try {
      const raw = readFileSync(path, 'utf8')
      return raw.trim() ? raw : null
    } catch {
      return null
    }
  }

  async function read(): Promise<string | null> {
    return (await readKeychain()) ?? readFileSlot()
  }

  function snapshotOf(payload: string): HostCredentialSnapshot {
    return {
      payload,
      medium: 'keychain',
      identity: input.parseIdentity(payload),
      expiresAtMs: input.parseExpiry(payload),
      capturedAt: Date.now()
    }
  }

  return {
    host: input.host,
    swappable: true,
    async capture(): Promise<HostCredentialSnapshot | null> {
      const payload = await read()
      return payload ? snapshotOf(payload) : null
    },
    async restore(snapshot: HostCredentialSnapshot): Promise<void> {
      if (snapshot.medium !== 'keychain' && snapshot.medium !== 'file') {
        throw new Error(`cannot restore ${snapshot.medium} snapshot into a keychain slot`)
      }
      if (process.platform === 'darwin' || input.run) {
        const acct = await resolveAccount()
        try {
          await run([
            'add-generic-password',
            '-U',
            '-s',
            input.service(),
            '-a',
            acct,
            '-w',
            snapshot.payload
          ])
          return
        } catch (err) {
          if (!input.fileFallback) throw err
        }
      }
      const dest = input.fileFallback?.()
      if (!dest) throw new Error(`keychain restore is unavailable for ${input.host}`)
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, snapshot.payload, { encoding: 'utf8', mode: 0o600 })
    },
    async liveIdentity(): Promise<string | null> {
      const payload = await read()
      return payload ? input.parseIdentity(payload) : null
    }
  }
}
