/**
 * Desktop app as a vav-server UI: pair from argv / env so the window is a shell.
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

/** Pairing URI from `--vav-server-uri` / `--vav-server` / `VAV_SERVER_URI`. */
export function resolveVavServerPairing(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv
): string | null {
  const fromArg = flagValue(argv, '--vav-server-uri') || flagValue(argv, '--vav-server')
  const fromEnv = env.VAV_SERVER_URI?.trim()
  const raw = (fromArg || fromEnv || '').trim()
  return raw || null
}

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag) || argv.some((arg) => arg === `${flag}=true` || arg === `${flag}=1`)
}

/**
 * Spawn a local vav-server and auto-pair so the desktop window is a shell.
 * Default on for packaged and `npm run dev`. `VAV_SERVER_SPAWN=0` / `--no-vav-server`
 * keeps the in-process host. Playwright sets that unless a spec asks for
 * a child daemon. Ignored when a pairing URI is already set.
 */
export function resolveVavServerSpawn(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv,
  _opts: { packaged?: boolean } = {}
): boolean {
  if (resolveVavServerPairing(env, argv)) return false
  if (env.VAV_SERVER_SPAWN === '0' || env.VAV_SERVER_SPAWN === 'false' || hasFlag(argv, '--no-vav-server')) {
    return false
  }
  if (hasFlag(argv, '--with-vav-server') || env.VAV_SERVER_SPAWN === '1' || env.VAV_SERVER_SPAWN === 'true') {
    return true
  }
  // Snapshot / default e2e stay in-process unless the spec opted in above.
  if (env.VAV_SNAPSHOT === '1' || env.VAV_E2E === '1') return false
  return true
}

/**
 * In-process bash restore only when this Electron is the host.
 * Spawned / paired vav-server owns PTY tabs — restoring here would mint a
 * second local pane Chrome and a remote desktop cannot see.
 */
export function shouldRestoreInProcessPty(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = process.argv,
  opts: { packaged?: boolean } = {}
): boolean {
  if (env.VAV_SNAPSHOT === '1') return false
  if (resolveVavServerPairing(env, argv)) return false
  if (resolveVavServerSpawn(env, argv, opts)) return false
  return true
}
