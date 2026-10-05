import { rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Droid's local login store under `~/.factory`. */
export const DROID_CREDENTIAL_FILES = [
  'auth.v2.file',
  'auth.v2.key',
  'auth.v2.keyring',
  'auth.v2.loginkeychain'
] as const

/** Local sign-out for Droid, which has no `logout` subcommand. */
export async function removeDroidCredentials(
  factoryDir = join(homedir(), '.factory')
): Promise<void> {
  await Promise.all(
    DROID_CREDENTIAL_FILES.map((name) => rm(join(factoryDir, name), { force: true }))
  )
}
