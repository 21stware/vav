import { parseDevinAuthStatusText, unknownAccount, type HostAccountInfo } from '@shared/cliAccountParse'
import { execCliText } from './cliProbe'

export async function readDevinAccountInfo(): Promise<HostAccountInfo> {
  const text = await execCliText(['devin'], ['auth', 'status'])
  if (!text) return unknownAccount()
  return parseDevinAuthStatusText(text)
}

export async function readDevinAuthIdentity(): Promise<string | null> {
  const info = await readDevinAccountInfo()
  return info.accountId ? `user:${info.accountId}` : null
}
