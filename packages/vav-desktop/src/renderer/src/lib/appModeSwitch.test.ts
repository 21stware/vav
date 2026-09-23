import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { nextApplicationsModePatch } from './appModeSwitch.ts'

describe('nextApplicationsModePatch', () => {
  it('returns the active tab to its list root', () => {
    assert.deepEqual(
      nextApplicationsModePatch('knowledge', 'knowledge', true, { knowledge: true }),
      {
        applicationsMode: 'knowledge',
        applicationsDetailOpen: false,
        applicationsDetailByMode: { knowledge: false }
      }
    )
  })

  it('restores the previous tab instead of forcing its list', () => {
    assert.deepEqual(
      nextApplicationsModePatch('knowledge', 'data', true, { data: true }),
      {
        applicationsMode: 'data',
        applicationsDetailOpen: true,
        applicationsDetailByMode: { knowledge: true, data: true }
      }
    )
    assert.deepEqual(
      nextApplicationsModePatch('data', 'knowledge', false, { knowledge: true, data: true }),
      {
        applicationsMode: 'knowledge',
        applicationsDetailOpen: true,
        applicationsDetailByMode: { knowledge: true, data: false }
      }
    )
  })
})
