import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  defaultOnboardingAgent,
  onboardingAgentRows,
  onboardingSteps,
  phaseSteps,
  type OnboardingCliAgent
} from './onboardingSteps.ts'

const CATALOGUE: OnboardingCliAgent[] = [
  { id: 'claude', name: 'Claude Code', installCommand: 'curl claude' },
  { id: 'cursor', name: 'Cursor', installCommand: 'curl cursor' },
  { id: 'codex', name: 'Codex', installCommand: 'curl codex' },
  { id: 'droid', name: 'Droid', installCommand: ' curl droid ' }
]

describe('onboardingSteps', () => {
  it('adds the Keychain step on macOS only', () => {
    assert.deepEqual(onboardingSteps('darwin'), ['welcome', 'security', 'agent', 'workspace'])
    assert.deepEqual(onboardingSteps('win32'), ['welcome', 'agent', 'workspace'])
  })

  it('splits macOS around bootstrap', () => {
    assert.deepEqual(phaseSteps('gate', 'darwin'), ['welcome', 'security'])
    assert.deepEqual(phaseSteps('gate', 'darwin', true), ['security'])
    assert.deepEqual(phaseSteps('setup', 'darwin'), ['agent', 'workspace'])
  })

  it('runs the whole flow after bootstrap elsewhere, and everything in preview', () => {
    assert.deepEqual(phaseSteps('setup', 'linux'), ['welcome', 'agent', 'workspace'])
    assert.deepEqual(phaseSteps('preview', 'darwin'), onboardingSteps('darwin'))
  })
})

describe('onboardingAgentRows', () => {
  it('lists installed CLIs, then VAV, then featured CLIs still missing', () => {
    const rows = onboardingAgentRows(
      CATALOGUE,
      { claude: 'missing', cursor: 'ready', codex: 'ready', droid: 'unknown' },
      'VAV'
    )
    assert.deepEqual(
      rows.map((row) => `${row.id}:${row.kind === 'cli' ? row.install : 'vav'}`),
      ['cursor:ready', 'codex:ready', 'vav:vav', 'claude:missing', 'droid:unknown']
    )
    const droid = rows.find((row) => row.id === 'droid')
    assert.equal(droid?.kind === 'cli' && droid.installCommand, 'curl droid')
  })

  it('does not repeat an installed featured CLI', () => {
    const rows = onboardingAgentRows(CATALOGUE, { claude: 'ready' }, 'VAV')
    assert.deepEqual(
      rows.map((row) => row.id),
      ['claude', 'vav', 'codex', 'droid']
    )
  })
})

describe('defaultOnboardingAgent', () => {
  const rows = onboardingAgentRows(CATALOGUE, { cursor: 'ready', codex: 'ready' }, 'VAV')

  it('prefers an installed CLI that is signed in', () => {
    assert.equal(defaultOnboardingAgent(rows, new Set(['codex'])), 'codex')
  })

  it('falls back to the first installed CLI, then VAV', () => {
    assert.equal(defaultOnboardingAgent(rows, new Set()), 'cursor')
    assert.equal(defaultOnboardingAgent(onboardingAgentRows(CATALOGUE, {}, 'VAV'), new Set()), 'vav')
  })

  it('ignores sign-in on a CLI that is not installed', () => {
    const none = onboardingAgentRows(CATALOGUE, { claude: 'missing' }, 'VAV')
    assert.equal(defaultOnboardingAgent(none, new Set(['claude'])), 'vav')
  })
})
