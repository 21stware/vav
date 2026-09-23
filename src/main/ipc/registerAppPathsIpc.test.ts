import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { IPC } from '../../shared/ipc.ts'
import { registerAppPathsIpc } from './registerAppPathsIpc.ts'

describe('registerAppPathsIpc', () => {
  it('reads and writes the pointer, and notifies temp-dir changes', async () => {
    const home = mkdtempSync(join(tmpdir(), 'vav-paths-ipc-home-'))
    const legacy = mkdtempSync(join(tmpdir(), 'vav-paths-ipc-legacy-'))
    const current = mkdtempSync(join(tmpdir(), 'vav-paths-ipc-current-'))
    mkdirSync(join(current, 'conversations'), { recursive: true })
    writeFileSync(join(current, 'settings.json'), '{}')
    const temps: string[] = []
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    registerAppPathsIpc(
      {
        handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
          handlers.set(channel, fn)
        }
      } as never,
      {
        legacyUserDataDir: () => legacy,
        currentUserDataDir: () => current,
        home: () => home,
        onTempDirChanged: (dir) => temps.push(dir)
      }
    )

    const initial = (await handlers.get(IPC.settingsAppPaths)?.()) as { defaultAppDataDir: string }
    assert.equal(initial.defaultAppDataDir, join(home, '.vav'))

    const dest = join(home, 'iCloud', 'VAV')
    const afterApp = (await handlers.get(IPC.settingsSetAppDataDir)?.({}, dest)) as {
      effectiveAppDataDir: string
      restartRequired: boolean
    }
    assert.equal(afterApp.effectiveAppDataDir, dest)
    assert.equal(afterApp.restartRequired, true)

    const customTmp = join(home, 'tmp-vav')
    const afterTmp = (await handlers.get(IPC.settingsSetTempDir)?.({}, customTmp)) as {
      tempIsCustom: boolean
      effectiveTempDir: string
    }
    assert.equal(afterTmp.tempIsCustom, true)
    assert.equal(afterTmp.effectiveTempDir, customTmp)
    assert.deepEqual(temps, [customTmp])

    const restored = (await handlers.get(IPC.settingsSetTempDir)?.({}, null)) as {
      tempIsCustom: boolean
    }
    assert.equal(restored.tempIsCustom, false)
    assert.equal(temps.at(-1), tmpdir())
  })
})
