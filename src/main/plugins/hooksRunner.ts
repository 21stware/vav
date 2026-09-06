import { spawn } from 'node:child_process'
import {
  hookEventMatches,
  hookMatcherMatches,
  type PluginHook,
  type PluginHookEvent
} from '../../shared/plugins.ts'

const HOOK_TIMEOUT_MS = 8_000
const HOOK_OUTPUT_CAP = 8_000

export type HookRunResult = {
  blocked: boolean
  reason?: string
  output: string
}

export async function runPluginHooks(opts: {
  hooks: PluginHook[]
  event: PluginHookEvent
  toolName?: string
  cwd: string
  env?: Record<string, string>
}): Promise<HookRunResult> {
  const matched = opts.hooks.filter(
    (hook) =>
      hook.enabled &&
      hookEventMatches(hook.event, opts.event) &&
      hookMatcherMatches(hook.matcher, opts.toolName ?? '')
  )
  if (matched.length === 0) return { blocked: false, output: '' }
  const chunks: string[] = []
  for (const hook of matched) {
    const result = await runHookCommand(hook.command, opts.cwd, opts.env)
    if (result.text) chunks.push(result.text)
    if (result.code !== 0) {
      return {
        blocked: opts.event === 'PreToolUse',
        reason: result.text || `Hook exited ${result.code}`,
        output: chunks.join('\n').slice(0, HOOK_OUTPUT_CAP)
      }
    }
  }
  return { blocked: false, output: chunks.join('\n').slice(0, HOOK_OUTPUT_CAP) }
}

function runHookCommand(
  command: string,
  cwd: string,
  extraEnv?: Record<string, string>
): Promise<{ code: number; text: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      env: { ...process.env, ...extraEnv },
      shell: true,
      timeout: HOOK_TIMEOUT_MS
    })
    const chunks: Buffer[] = []
    child.stdout?.on('data', (buf: Buffer) => chunks.push(buf))
    child.stderr?.on('data', (buf: Buffer) => chunks.push(buf))
    child.on('error', (err) => resolve({ code: 1, text: err.message }))
    child.on('close', (code) => {
      resolve({
        code: code ?? 1,
        text: Buffer.concat(chunks).toString('utf8').trim().slice(0, HOOK_OUTPUT_CAP)
      })
    })
  })
}
