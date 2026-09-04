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

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag) || argv.some((arg) => arg === `${flag}=true` || arg === `${flag}=1`)
}

/**
 * Spawn a local vavd and auto-pair so the desktop window is a shell.
 * `--with-vavd` / `VAVD_SPAWN=1`. Packaged apps spawn by default (the
 * installer ships vavd.js). `VAVD_SPAWN=0` / `--no-vavd` keeps the in-process
 * host. Ignored when a pairing URI is already set.
 */
export function resolveVavdSpawn(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv,
  opts: { packaged?: boolean } = {}
): boolean {
  if (resolveVavdPairing(env, argv)) return false
  if (env.VAVD_SPAWN === '0' || env.VAVD_SPAWN === 'false' || hasFlag(argv, '--no-vavd')) {
    return false
  }
  if (hasFlag(argv, '--with-vavd') || env.VAVD_SPAWN === '1' || env.VAVD_SPAWN === 'true') {
    return true
  }
  return opts.packaged === true
}
