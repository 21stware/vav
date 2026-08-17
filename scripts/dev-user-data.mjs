/**
 * Dev Electron userData only. Scripts that seed or kill must import this —
 * never write `~/Library/Application Support/vav` (the packaged app).
 */
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

export const DEV_USER_DATA_NAME = 'vav-dev'

export function assertDevUserData(dir) {
  if (basename(dir) !== DEV_USER_DATA_NAME) {
    throw new Error(`refusing to touch non-dev userData: ${dir}`)
  }
}

export function devUserDataDir() {
  const dir = join(homedir(), 'Library/Application Support', DEV_USER_DATA_NAME)
  assertDevUserData(dir)
  return dir
}
