import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolveAgentExecutable } from '../terminal/loginPath'

const execFileAsync = promisify(execFile)
const CLI_TIMEOUT_MS = 8_000

/**
 * Run a provider CLI and parse JSON stdout.
 * Uses the login-PATH binary so Electron's stripped PATH still finds it.
 */
export async function execCliJson(
  candidates: string[],
  args: string[]
): Promise<unknown | null> {
  const bin = resolveAgentExecutable(candidates)
  if (!bin) return null
  try {
    const { stdout } = await execFileAsync(bin, args, {
      timeout: CLI_TIMEOUT_MS,
      maxBuffer: 256 * 1024
    })
    const text = stdout.toString().trim()
    if (!text) return null
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Same PATH resolve as {@link execCliJson}, but keep stdout as text. */
export async function execCliText(
  candidates: string[],
  args: string[]
): Promise<string | null> {
  const bin = resolveAgentExecutable(candidates)
  if (!bin) return null
  try {
    const { stdout } = await execFileAsync(bin, args, {
      timeout: CLI_TIMEOUT_MS,
      maxBuffer: 256 * 1024
    })
    const text = stdout.toString().trim()
    return text || null
  } catch {
    return null
  }
}
