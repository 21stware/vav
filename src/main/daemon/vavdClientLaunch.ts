/**
 * Desktop app as a vavd UI: pair from argv / env so the window is a shell.
 * Same URI `vav` CLI and Connect already paste.
 */

function flagValue(argv: string[], flag: string): string | null {
  const prefix = `${flag}=`
  for (const arg of argv) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length) || null
  }
  const index = argv.indexOf(flag)
  if (index >= 0 && argv[index + 1] && !argv[index + 1]!.startsWith('-')) {
    return argv[index + 1] ?? null
  }
  return null
}

/** Pairing URI from `--vavd-uri` / `--vavd` / `VAVD_URI`. */
export function resolveVavdPairing(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv
): string | null {
  const fromArg = flagValue(argv, '--vavd-uri') || flagValue(argv, '--vavd')
  const fromEnv = env.VAVD_URI?.trim()
  const raw = (fromArg || fromEnv || '').trim()
  return raw || null
}
