import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { IPC } from '@shared/ipc'
import {
  SESSION_SECRETS_MAX,
  normalizeEnvName,
  normalizeSecretValues,
  type SessionSecretMutateResult,
  type SessionSecretRevealResult
} from '@shared/sessionSecrets'
import type { OwnerAuthResult } from '../auth/localOwnerAuth.ts'

export type SessionSecretsIpcHost = {
  list: (conversationId: string) => string[]
  peek: (conversationId: string, name: string) => string | null
  upsert: (conversationId: string, values: Record<string, string>) => string[]
  remove: (conversationId: string, name: string) => string[]
  evaluateOwner: (event: IpcMainInvokeEvent, reason: string) => Promise<OwnerAuthResult>
  revealReason: () => string
}

/** Workspace Secrets tab: names are public; values require owner eval. */
export function registerSessionSecretsIpc(ipcMain: IpcMain, host: SessionSecretsIpcHost): void {
  ipcMain.handle(IPC.sessionSecretsList, (_event, conversationId: string) => {
    const id = String(conversationId ?? '').trim()
    return { names: id ? host.list(id) : [] }
  })

  ipcMain.handle(
    IPC.sessionSecretsReveal,
    async (event, conversationId: string, name: string): Promise<SessionSecretRevealResult> => {
      const id = String(conversationId ?? '').trim()
      const envName = normalizeEnvName(name)
      if (!id || !envName) return { ok: false, error: 'Unknown secret' }
      if (!host.peek(id, envName)) return { ok: false, error: 'Unknown secret' }
      const auth = await host.evaluateOwner(event, host.revealReason())
      if (!auth.ok) {
        return auth.cancelled
          ? { ok: false, cancelled: true }
          : { ok: false, error: auth.error ?? 'Verification failed' }
      }
      const value = host.peek(id, envName)
      if (!value) return { ok: false, error: 'Unknown secret' }
      return { ok: true, value }
    }
  )

  ipcMain.handle(
    IPC.sessionSecretsSet,
    (_event, conversationId: string, name: string, value: string): SessionSecretMutateResult => {
      const id = String(conversationId ?? '').trim()
      const envName = normalizeEnvName(name)
      if (!id) return { ok: false, error: 'No session' }
      if (!envName) return { ok: false, error: 'invalid-name' }
      const trimmed = String(value ?? '').replace(/\0/g, '').trim()
      if (!trimmed) return { ok: false, error: 'empty' }
      const existing = new Set(host.list(id))
      if (!existing.has(envName) && existing.size >= SESSION_SECRETS_MAX) {
        return { ok: false, error: 'limit' }
      }
      const names = host.upsert(id, normalizeSecretValues({ [envName]: trimmed }))
      return { ok: true, names }
    }
  )

  ipcMain.handle(
    IPC.sessionSecretsRemove,
    (_event, conversationId: string, name: string): SessionSecretMutateResult => {
      const id = String(conversationId ?? '').trim()
      const envName = normalizeEnvName(name)
      if (!id || !envName) return { ok: false, error: 'Unknown secret' }
      return { ok: true, names: host.remove(id, envName) }
    }
  )
}
