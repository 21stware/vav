/**
 * How a resolved CLI agent binary is launched inside the PTY.
 *
 * Happy path: exec the absolute path directly. A login shell (`zsh -ilc`)
 * costs 0.6–1.2s on a typical Mac and is only needed when we still have a
 * bare command name the GUI PATH cannot see.
 */

export function isAbsoluteExecutable(file: string): boolean {
  const trimmed = file.trim()
  if (!trimmed) return false
  if (trimmed.startsWith('/')) return true
  return /^[A-Za-z]:[\\/]/.test(trimmed)
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function planCliAgentSpawn(options: {
  resolved: string
  agentArgs: string[]
  shell: string
  isWindows: boolean
}): { file: string; args: string[] } {
  const resolved = options.resolved.trim()
  const agentArgs = options.agentArgs
  if (options.isWindows || isAbsoluteExecutable(resolved)) {
    return { file: resolved, args: agentArgs }
  }
  const cmdline = [shQuote(resolved), ...agentArgs.map(shQuote)].join(' ')
  return { file: options.shell, args: ['-ilc', `exec ${cmdline}`] }
}
