import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { IPC } from '../../shared/ipc.ts'
import { DEFAULT_SETTINGS } from '../../shared/types.ts'
import { registerSettingsIpc } from './registerSettingsIpc.ts'

describe('registerSettingsIpc', () => {
  it('merges host prefs from spawned vavd and keeps theme local', async () => {
    const calls: string[] = []
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const ipcMain = {
      handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
        handlers.set(channel, fn)
      }
    }
    let stored = { ...DEFAULT_SETTINGS, theme: 'dark' as const }
    registerSettingsIpc(
      ipcMain as never,
      {
        get: () => stored,
        update: (patch) => {
          stored = { ...stored, ...patch }
          return stored
        },
        reset: () => stored
      },
      {
        clear: () => undefined,
        set: () => undefined,
        get: () => null,
        maskedHint: () => null
      },
      {
        currentSettings: () => stored,
        applyUpdateSideEffects: () => undefined,
        applyResetSideEffects: () => undefined,
        broadcastSettings: () => undefined,
        keepAwakeStatus: () => ({}),
        keepAwakeGrant: async () => ({}),
        keepAwakeRevoke: async () => ({}),
        confirmRevealSecret: async () => false,
        validateKey: async () => ({ ok: true }),
        noApiKeyMessage: () => '',
        fonts: () => [],
        registerHotkey: () => true,
        pickDirectory: async () => null,
        grantPath: () => undefined,
        pickSurfacePattern: async () => null,
        chooseColor: async () => null,
        cliStatus: () => ({}),
        cliSetLocation: () => ({}),
        cliInstall: () => ({}),
        cliUninstall: () => ({}),
        fileAssociations: () => [],
        fileAssociationForPath: async () => null,
        setFileAssociation: () => ({}),
        unsetFileAssociation: () => ({}),
        registerAllFileAssociations: () => ({}),
        remote: () => ({
          request: async (method, params) => {
            calls.push(method)
            if (method === 'settings.get') return { defaultModel: 'hosted-model', apiKeyPresent: true }
            if (method === 'settings.update') return params
            if (method === 'settings.setSecret') return { hint: 'sk-…', apiKeyPresent: true }
            return {}
          }
        })
      }
    )

    const page = (await handlers.get(IPC.settingsGet)?.({})) as { defaultModel?: string; theme?: string }
    assert.equal(page.defaultModel, 'hosted-model')
    assert.equal(page.theme, 'dark')
    await handlers.get(IPC.settingsUpdate)?.({}, { defaultModel: 'next', theme: 'light' })
    assert.ok(calls.includes('settings.get'))
    assert.ok(calls.includes('settings.update'))
    assert.equal(stored.theme, 'light')
    assert.notEqual(stored.defaultModel, 'next')
    const hint = (await handlers.get(IPC.settingsSetKey)?.({}, 'sk-hosted')) as { hint?: string }
    assert.equal(hint.hint, 'sk-…')
    assert.ok(calls.includes('settings.setSecret'))
  })
})
