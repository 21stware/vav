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

  it('does not write host prefs locally when a remote settings.update fails', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const ipcMain = {
      handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
        handlers.set(channel, fn)
      }
    }
    let stored = { ...DEFAULT_SETTINGS, defaultModel: 'local-model' }
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
        activeMachineId: () => 'macmini-v1',
        remote: () => ({
          request: async (method) => {
            if (method === 'settings.get') return { defaultModel: 'hosted-model' }
            if (method === 'settings.update') throw new Error('unavailable')
            return {}
          }
        })
      }
    )

    const next = (await handlers.get(IPC.settingsUpdate)?.({}, { defaultModel: 'poison' })) as {
      defaultModel?: string
      hostSettingsUnavailable?: boolean
    }
    assert.equal(stored.defaultModel, 'local-model')
    assert.equal(next.hostSettingsUnavailable, true)
    assert.notEqual(next.defaultModel, 'poison')
  })

  it('tags remote host recents with the paired machine id', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    const ipcMain = {
      handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
        handlers.set(channel, fn)
      }
    }
    const hostId = 'macmini-v1'
    const extra = '/tmp/host-extra'
    let stored = {
      ...DEFAULT_SETTINGS,
      recentWorkspaceDirectories: [{ machineId: hostId, path: '/tmp/catalog-only' }]
    }
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
        activeMachineId: () => hostId,
        remote: () => ({
          request: async (method) => {
            if (method === 'settings.get') {
              return { recentWorkspaceDirectories: [extra], defaultModel: 'hosted-model' }
            }
            return {}
          }
        })
      }
    )

    const page = (await handlers.get(IPC.settingsGet)?.({})) as {
      defaultModel?: string
      recentWorkspaceDirectories?: Array<{ machineId: string; path: string }>
    }
    assert.equal(page.defaultModel, 'hosted-model')
    assert.ok(
      page.recentWorkspaceDirectories?.some(
        (entry) => entry.path === extra && entry.machineId === hostId
      )
    )
    assert.ok(
      page.recentWorkspaceDirectories?.some(
        (entry) => entry.path === '/tmp/catalog-only' && entry.machineId === hostId
      )
    )
  })
})

