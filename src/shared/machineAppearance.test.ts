import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DEFAULT_SETTINGS } from './types.ts'
import {
  appearanceForMachine,
  patchMachineAppearance,
  pickAppearanceBase
} from './machineAppearance.ts'

describe('machineAppearance', () => {
  it('inherits the global look when a host has no overlay or remote base', () => {
    const resolved = appearanceForMachine(
      { ...DEFAULT_SETTINGS, theme: 'dark', colorTint: 'teal', surfacePattern: 'dots' },
      'macmini-v1'
    )
    assert.equal(resolved.theme, 'dark')
    assert.equal(resolved.colorTint, 'teal')
    assert.equal(resolved.surfacePattern, 'dots')
  })

  it('uses the per-connection overlay when set', () => {
    const resolved = appearanceForMachine(
      {
        ...DEFAULT_SETTINGS,
        theme: 'system',
        colorTint: 'system',
        surfacePattern: 'none',
        machineAppearances: {
          'macmini-v1': { theme: 'light', colorTint: 'rose', surfacePattern: 'grain' }
        }
      },
      'macmini-v1'
    )
    assert.equal(resolved.theme, 'light')
    assert.equal(resolved.colorTint, 'rose')
    assert.equal(resolved.surfacePattern, 'grain')
  })

  it('inherits a remote host look before the local global', () => {
    const resolved = appearanceForMachine(
      { ...DEFAULT_SETTINGS, theme: 'dark', colorTint: 'teal', surfacePattern: 'none' },
      'macmini-v1',
      { theme: 'light', colorTint: 'rose', surfacePattern: 'hatch' }
    )
    assert.equal(resolved.theme, 'light')
    assert.equal(resolved.colorTint, 'rose')
    assert.equal(resolved.surfacePattern, 'hatch')
  })

  it('drops a remote custom pattern so this computer does not reuse a foreign tile', () => {
    const base = pickAppearanceBase({
      theme: 'dark',
      surfacePattern: 'custom',
      customSurfacePatternUrl: 'vav-local://pattern.png'
    })
    assert.equal(base.theme, 'dark')
    assert.equal(base.surfacePattern, undefined)
    const resolved = appearanceForMachine(
      { ...DEFAULT_SETTINGS, surfacePattern: 'none' },
      'macmini-v1',
      { theme: 'dark', surfacePattern: 'custom', customSurfacePatternUrl: 'vav-local://x' }
    )
    assert.equal(resolved.surfacePattern, 'none')
  })

  it('patches one machine without dropping the others', () => {
    const next = patchMachineAppearance(
      { local: { theme: 'dark' } },
      'macmini-v1',
      { theme: 'light', surfacePattern: 'dots' }
    )
    assert.equal(next.local?.theme, 'dark')
    assert.equal(next['macmini-v1']?.theme, 'light')
    assert.equal(next['macmini-v1']?.surfacePattern, 'dots')
  })
})
