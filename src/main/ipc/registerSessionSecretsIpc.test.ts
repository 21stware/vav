import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { IPC } from '../../shared/ipc.ts'
import { SessionSecretStore } from '../store/SessionSecretStore.ts'
import { registerSessionSecretsIpc } from './registerSessionSecretsIpc.ts'

describe('registerSessionSecretsIpc', () => {
  it('lists names without values and gates reveal on owner eval', async () => {
    const store = new SessionSecretStore()
    store.setMany('c1', { OPENAI_API_KEY: 'sk-live' })
    let allowReveal = false
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    registerSessionSecretsIpc(
      {
        handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
          handlers.set(channel, fn)
        }
      } as never,
      {
        list: (id) => store.listNames(id),
        peek: (id, name) => store.getEnv(id)[name] ?? null,
        upsert: (id, values) => store.setMany(id, values),
        remove: (id, name) => {
          store.remove(id, name)
          return store.listNames(id)
        },
        evaluateOwner: async () =>
          allowReveal ? { ok: true as const } : { ok: false as const, cancelled: true },
        revealReason: () => 'Reveal'
      }
    )

    const listed = (await handlers.get(IPC.sessionSecretsList)?.({}, 'c1')) as { names: string[] }
    assert.deepEqual(listed.names, ['OPENAI_API_KEY'])
    assert.equal(JSON.stringify(listed).includes('sk-live'), false)

    const denied = (await handlers.get(IPC.sessionSecretsReveal)?.({}, 'c1', 'OPENAI_API_KEY')) as {
      ok: boolean
      cancelled?: boolean
    }
    assert.equal(denied.ok, false)
    assert.equal(denied.cancelled, true)

    allowReveal = true
    const shown = (await handlers.get(IPC.sessionSecretsReveal)?.({}, 'c1', 'OPENAI_API_KEY')) as {
      ok: boolean
      value?: string
    }
    assert.deepEqual(shown, { ok: true, value: 'sk-live' })

    const added = (await handlers.get(IPC.sessionSecretsSet)?.({}, 'c1', 'GH_TOKEN', 'ghs_x')) as {
      names: string[]
    }
    assert.deepEqual(added.names, ['GH_TOKEN', 'OPENAI_API_KEY'])
    const removed = (await handlers.get(IPC.sessionSecretsRemove)?.({}, 'c1', 'OPENAI_API_KEY')) as {
      names: string[]
    }
    assert.deepEqual(removed.names, ['GH_TOKEN'])
  })

  it('rejects a bad env name on set', async () => {
    const store = new SessionSecretStore()
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    registerSessionSecretsIpc(
      {
        handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
          handlers.set(channel, fn)
        }
      } as never,
      {
        list: (id) => store.listNames(id),
        peek: () => null,
        upsert: (id, values) => store.setMany(id, values),
        remove: () => [],
        evaluateOwner: async () => ({ ok: true }),
        revealReason: () => 'Reveal'
      }
    )
    const bad = (await handlers.get(IPC.sessionSecretsSet)?.({}, 'c1', '1BAD', 'x')) as {
      ok: boolean
      error?: string
    }
    assert.equal(bad.ok, false)
    assert.equal(bad.error, 'invalid-name')
  })
})
