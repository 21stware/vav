import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DEFAULT_SETTINGS } from './types.ts'
import { appearanceForMachine, patchMachineAppearance } from './machineAppearance.ts'

describe('machineAppearance', () => {
  it('inherits the global look when a host has no overlay', () => {
    const resolved = appearanceForMachine(
      { ...DEFAULT_SETTINGS, theme: 'dark', colorTint: 'teal' },
      'macmini-v1'
    )
    assert.equal(resolved.theme, 'dark')
    assert.equal(resolved.colorTint, 'teal')
  })

  it('uses the per-connection overlay when set', () => {
    const resolved = appearanceForMachine(
      {
        ...DEFAULT_SETTINGS,
        theme: 'system',
        colorTint: 'system',
        machineAppearances: { 'macmini-v1': { theme: 'light', colorTint: 'rose' } }
      },
      'macmini-v1'
    )
    assert.equal(resolved.theme, 'light')
    assert.equal(resolved.colorTint, 'rose')
  })

  it('patches one machine without dropping the others', () => {
    const next = patchMachineAppearance(
      { local: { theme: 'dark' } },
      'macmini-v1',
      { theme: 'light' }
    )
    assert.equal(next.local?.theme, 'dark')
    assert.equal(next['macmini-v1']?.theme, 'light')
  })
})
