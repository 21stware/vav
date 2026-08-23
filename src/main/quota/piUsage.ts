import { readFile } from 'node:fs/promises'
import { accountInfo, asAccountRecord, unknownAccount, type HostAccountInfo } from '@shared/cliAccountParse'
import { piAuthPath } from './hostPaths.ts'

export async function readPiAccountInfo(): Promise<HostAccountInfo> {
  try {
    const raw = await readFile(piAuthPath(), 'utf8')
    const rec = asAccountRecord(JSON.parse(raw))
    if (rec && Object.keys(rec).length > 0) return accountInfo('api-key')
  } catch {
    // missing / malformed
  }
  return unknownAccount()
}
