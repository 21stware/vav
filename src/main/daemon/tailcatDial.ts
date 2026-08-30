/**
 * Outgoing tailcat dial: spawn the sidecar in `--dial` mode and expose the
 * remote bridge on 127.0.0.1 so DaemonClient can speak JSON-lines over it.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { drainJsonLines } from '../../shared/remoteControl.ts'
import { resolveSidecarBinary } from '../remote/sidecarBinary.ts'

export type TailcatDialHandle = {
  host: string
  port: number
  close: () => void
}

const DIAL_READY_MS = 45_000

export function openTailcatDial(token: string): Promise<TailcatDialHandle> {
  const binary = resolveSidecarBinary()
  if (!binary) return Promise.reject(new Error('tailcatbridge binary not found'))
  const trimmed = token.trim()
  if (!trimmed.startsWith('tc')) return Promise.reject(new Error('invalid tailcat token'))

  return new Promise((resolve, reject) => {
    let child: ChildProcess
    try {
      child = spawn(binary, ['--dial', trimmed], { stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
      return
    }

    let settled = false
    let stdout = ''
    const stderr: string[] = []
    const timer = setTimeout(() => {
      fail(new Error('tailcat dial timed out'))
    }, DIAL_READY_MS)

    const fail = (err: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill()
      reject(err)
    }

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
      const { values, rest } = drainJsonLines(stdout)
      stdout = rest
      for (const value of values) {
        if (!value || typeof value !== 'object') continue
        const event = value as { event?: unknown; port?: unknown }
        if (event.event === 'ready' && typeof event.port === 'number' && event.port > 0) {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve({
            host: '127.0.0.1',
            port: event.port,
            close: () => {
              try {
                child.stdin?.end()
              } catch {
                /* ignore */
              }
              child.kill()
            }
          })
        }
      }
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr.push(chunk)
    })
    child.on('error', (err) => fail(err))
    child.on('exit', (code) => {
      if (settled) return
      const detail = stderr.join('').trim().split('\n').slice(-3).join('\n')
      fail(
        new Error(
          `tailcat dial exited (${code ?? 'signal'})${detail ? `: ${detail}` : ''}`
        )
      )
    })
  })
}
