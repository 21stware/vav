import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startAcpLogin } from './acpHostLogin.ts'
import { DROID_CREDENTIAL_FILES, removeDroidCredentials } from './droidCredentials.ts'

/** Minimal ACP host: answers initialize, then authenticate per `mode`. */
function fakeAcpHost(mode: 'ok' | 'error' | 'hang' | 'exit'): string {
  return `
const readline = require('node:readline')
const rl = readline.createInterface({ input: process.stdin })
const out = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\\n')
rl.on('line', (line) => {
  const msg = JSON.parse(line)
  if (msg.method === 'initialize') {
    out({ id: msg.id, result: { protocolVersion: 1, authMethods: [{ id: 'device-pairing', name: 'Login' }] } })
    return
  }
  if (msg.method === 'authenticate') {
    if (msg.params.methodId !== 'device-pairing') {
      out({ id: msg.id, error: { code: -32602, message: 'bad method ' + msg.params.methodId } })
      return
    }
    if (${JSON.stringify(mode)} === 'ok') out({ id: msg.id, result: {} })
    else if (${JSON.stringify(mode)} === 'error') out({ id: msg.id, error: { code: -32603, message: 'Device authentication failed', data: { details: 'pairing expired' } } })
    else if (${JSON.stringify(mode)} === 'exit') process.exit(0)
  }
})
`
}

function run(mode: 'ok' | 'error' | 'hang' | 'exit', timeoutMs?: number) {
  return startAcpLogin({
    file: process.execPath,
    args: ['-e', fakeAcpHost(mode)],
    methodId: 'device-pairing',
    cwd: tmpdir(),
    env: process.env,
    timeoutMs
  })
}

describe('startAcpLogin', () => {
  it('resolves 0 once authenticate succeeds', async () => {
    const result = await run('ok').done
    assert.equal(result.exitCode, 0)
  })

  it('reports the host error when authenticate fails', async () => {
    const result = await run('error').done
    assert.equal(result.exitCode, 1)
    assert.equal(result.message, 'pairing expired')
  })

  it('treats an early exit as a failed login', async () => {
    const result = await run('exit').done
    assert.equal(result.exitCode, 1)
  })

  it('times out a pairing that never finishes', async () => {
    const result = await run('hang', 300).done
    assert.equal(result.exitCode, 1)
    assert.match(result.message ?? '', /timed out/)
  })

  it('reports null when cancelled', async () => {
    const job = run('hang')
    setTimeout(() => job.kill(), 100)
    const result = await job.done
    assert.equal(result.exitCode, null)
  })
})

describe('removeDroidCredentials', () => {
  it('removes only the Droid login store', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-droid-auth-'))
    try {
      for (const name of DROID_CREDENTIAL_FILES) writeFileSync(join(dir, name), 'x')
      writeFileSync(join(dir, 'settings.json'), '{}')
      await removeDroidCredentials(dir)
      for (const name of DROID_CREDENTIAL_FILES) assert.equal(existsSync(join(dir, name)), false)
      assert.equal(existsSync(join(dir, 'settings.json')), true)
      await removeDroidCredentials(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
