/**
 * Talk to the host-owned Cua daemon through `cua-driver call --socket`.
 * The agent process never owns TCC; it only sends JSON to VAV.app's daemon.
 */
import { spawn } from 'node:child_process'
import { cap } from '../agent/toolSummarize.ts'

export type CuaCallResult = {
  ok: boolean
  text: string
  screenshotPath?: string
}

export type CuaCallOptions = {
  bin: string
  socket: string
  tool: string
  args?: Record<string, unknown>
  screenshotOut?: string
  timeoutMs?: number
  spawnImpl?: typeof spawn
}

function formatOutput(stdout: string, stderr: string): string {
  const body = stdout.trim() || stderr.trim()
  if (!body) return '(empty)'
  try {
    return JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    return body
  }
}

export async function callCuaTool(opts: CuaCallOptions): Promise<CuaCallResult> {
  const timeoutMs = opts.timeoutMs ?? 30_000
  const argv = ['call', opts.tool, JSON.stringify(opts.args ?? {}), '--socket', opts.socket]
  if (opts.screenshotOut) argv.push('--screenshot-out-file', opts.screenshotOut)
  const run = opts.spawnImpl ?? spawn

  return await new Promise((resolve) => {
    const child = run(opts.bin, argv, {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM')
      } catch {
        /* ignore */
      }
      resolve({ ok: false, text: `cua-driver call timed out after ${timeoutMs}ms (${opts.tool})` })
    }, timeoutMs)
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ ok: false, text: err.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const text = cap(formatOutput(stdout, stderr))
      resolve({
        ok: code === 0,
        text,
        screenshotPath: opts.screenshotOut
      })
    })
  })
}
