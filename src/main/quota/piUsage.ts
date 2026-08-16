import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { accountInfo, asAccountRecord, unknownAccount, type HostAccountInfo } from '@shared/cliAccountParse'

export async function readPiAccountInfo(): Promise<HostAccountInfo> {
  try {
    const raw = await readFile(join(homedir(), '.pi', 'agent', 'auth.json'), 'utf8')
    const rec = asAccountRecord(JSON.parse(raw))
    if (rec && Object.keys(rec).length > 0) return accountInfo('api-key')
  } catch {
    // missing / malformed
  }
  return unknownAccount()
}
