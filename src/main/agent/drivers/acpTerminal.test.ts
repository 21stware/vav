import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AcpTerminalRegistry } from './acpTerminal.ts'
import { AcpRpcError } from './acpFs.ts'

describe('AcpTerminalRegistry', () => {
  it('creates, captures output, waits, and releases a command', async () => {
    const terminals = new AcpTerminalRegistry()
    const created = terminals.create(
      { command: process.execPath, args: ['-e', "process.stdout.write('ok')"] },
      process.cwd()
    )
    const exit = await terminals.waitForExit(created.terminalId)
    assert.equal(exit.exitCode, 0)
    const snap = terminals.output(created.terminalId)
    assert.match(snap.output, /ok/)
    assert.equal(snap.truncated, false)
    terminals.release(created.terminalId)
    assert.throws(() => terminals.output(created.terminalId), AcpRpcError)
  })
})
