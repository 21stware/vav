import { basename } from 'node:path'

/** True when Playwright (or another harness) launched the app with VAV_E2E=1. */
export function isE2eRuntime(): boolean {
  return process.env.VAV_E2E === '1'
}

/**
 * Isolated userData for e2e. Refuses the real `vav` / `vav-dev` folders so a
 * mis-set env cannot wipe the developer's sessions.
 */
export function resolveE2eUserData(): string | null {
  if (!isE2eRuntime()) return null
  const dir = process.env.VAV_USER_DATA?.trim()
  if (!dir) {
    throw new Error('VAV_E2E=1 requires VAV_USER_DATA to be a throwaway directory')
  }
  const name = basename(dir)
  if (name === 'vav' || name === 'vav-dev') {
    throw new Error(`refusing to use real app userData for e2e: ${dir}`)
  }
  return dir
}
