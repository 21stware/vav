import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  acpCurrentModeId,
  acpFormContentFromAnswers,
  acpFormToQuestions,
  acpSessionModes,
  filterAcpCommands,
  parseAcpAvailableCommands,
  parseAcpConfigOptions,
  parseAcpFormSchema,
  parseAcpSessionModes,
  parseSlashDraft,
  patchAcpConfigOption,
  patchAcpSessionMode,
  acpSlashMenuMatches,
  applyGoalSlash,
  goalBannerActions,
  goalSlashText,
  goalUsesRpc,
  parseAcpGoalCapability,
  parseAcpGoalSnapshot,
  resolveGoalCapability,
  seedGoalCommands
} from './acpSession.ts'

describe('parseAcpSessionModes', () => {
  it('reads availableModes + currentModeId', () => {
    const parsed = parseAcpSessionModes({
      currentModeId: 'ask',
      availableModes: [
        { id: 'ask', name: 'Ask' },
        { id: 'agent', name: 'Agent', description: 'Full tools' }
      ]
    })
    assert.equal(parsed.currentModeId, 'ask')
    assert.equal(parsed.modes.length, 2)
    assert.equal(parsed.modes[1]?.description, 'Full tools')
  })
})

describe('parseAcpAvailableCommands / filter', () => {
  it('strips a leading slash and matches query', () => {
    const commands = parseAcpAvailableCommands({
      availableCommands: [
        { name: '/web', description: 'Search', input: { hint: 'query' } },
        { name: 'plan', description: 'Write a plan' }
      ]
    })
    assert.deepEqual(
      commands.map((c) => c.name),
      ['web', 'plan']
    )
    assert.equal(commands[0]?.hint, 'query')
    assert.equal(filterAcpCommands(commands, 'we')[0]?.name, 'web')
  })
})

describe('parseAcpConfigOptions', () => {
  it('reads select + boolean options', () => {
    const options = parseAcpConfigOptions([
      {
        id: 'mode',
        name: 'Mode',
        category: 'mode',
        type: 'select',
        currentValue: 'ask',
        options: [{ value: 'ask', name: 'Ask' }]
      },
      { id: 'brave', name: 'Brave', type: 'boolean', currentValue: true }
    ])
    assert.equal(options[0]?.currentValue, 'ask')
    assert.equal(options[1]?.currentValue, true)
    assert.equal(acpCurrentModeId({ configOptions: options }), 'ask')
    assert.equal(acpSessionModes({ configOptions: options })[0]?.id, 'ask')
  })
})

describe('patch ACP session / config', () => {
  it('keeps currentModeId and the mode config option in lockstep', () => {
    const seeded = parseAcpConfigOptions([
      {
        id: 'mode',
        name: 'Mode',
        category: 'mode',
        type: 'select',
        currentValue: 'agent',
        options: [
          { value: 'agent', name: 'Agent' },
          { value: 'plan', name: 'Plan' }
        ]
      }
    ])
    const fromMode = patchAcpSessionMode({ configOptions: seeded, currentModeId: 'agent' }, 'plan')
    assert.equal(fromMode.currentModeId, 'plan')
    assert.equal(acpCurrentModeId(fromMode), 'plan')

    const fromConfig = patchAcpConfigOption(fromMode, 'mode', 'agent')
    assert.equal(fromConfig?.currentModeId, 'agent')
    assert.equal(acpCurrentModeId(fromConfig), 'agent')
    assert.equal(patchAcpConfigOption(null, 'mode', 'plan'), null)
  })
})

describe('slash + form helpers', () => {
  it('parses a slash draft and the visible menu rows', () => {
    assert.deepEqual(parseSlashDraft('/web cats'), { name: 'web', rest: ' cats' })
    assert.equal(parseSlashDraft('hello'), null)
    const commands = [
      { name: 'compact', description: 'Compact' },
      { name: 'cost', description: 'Cost' }
    ]
    assert.deepEqual(
      acpSlashMenuMatches('/', commands)?.map((row) => row.name),
      ['compact', 'cost']
    )
    assert.deepEqual(
      acpSlashMenuMatches('/comp', commands)?.map((row) => row.name),
      ['compact']
    )
    assert.equal(acpSlashMenuMatches('/compact ', commands), null)
    assert.equal(acpSlashMenuMatches('/zzz', commands), null)
  })

  it('maps a form schema onto ask questions and answers', () => {
    const fields = parseAcpFormSchema({
      type: 'object',
      required: ['strategy'],
      properties: {
        strategy: { type: 'string', enum: ['safe', 'fast'], title: 'How?' }
      }
    })
    assert.equal(fields[0]?.required, true)
    assert.deepEqual(acpFormToQuestions(fields), [
      { question: 'How?', choices: ['safe', 'fast'], multiSelect: false }
    ])
    assert.deepEqual(acpFormContentFromAnswers(fields, [{ answer: 'safe' }]), { strategy: 'safe' })
  })
})

describe('ACP goal extension', () => {
  it('parses advertised capability and ignores snapshot-shaped objects', () => {
    const cap = parseAcpGoalCapability({
      version: 1,
      controlMethod: '_session/goal',
      actions: ['clear', 'pause', 'nope']
    })
    assert.deepEqual(cap?.actions, ['clear', 'pause'])
    assert.deepEqual(cap?.methodActions, ['clear', 'pause'])
    assert.equal(parseAcpGoalCapability({ objective: 'Ship it', status: 'active' }), null)
  })

  it('parses snapshots and treats null as an explicit clear', () => {
    const snap = parseAcpGoalSnapshot({
      objective: 'Migrate auth',
      status: 'in_progress',
      createdAt: 1_710_000_000,
      last_reason: 'running tests'
    })
    assert.equal(snap?.objective, 'Migrate auth')
    assert.equal(snap?.status, 'active')
    assert.equal(snap?.createdAt, 1_710_000_000_000)
    assert.equal(snap?.lastReason, 'running tests')
    assert.equal(parseAcpGoalSnapshot(null), null)
    assert.equal(parseAcpGoalSnapshot(undefined), undefined)
    assert.equal(
      parseAcpGoalSnapshot({ controlMethod: '_session/goal', actions: ['clear'] }),
      undefined
    )
  })

  it('seeds Grok /goal and unions slash actions onto advertised RPC', () => {
    const advertised = parseAcpGoalCapability({
      controlMethod: '_session/goal',
      actions: ['clear']
    })
    const commands = seedGoalCommands('grok', [{ name: 'compact' }])
    assert.equal(commands[0]?.name, 'goal')
    const cap = resolveGoalCapability('grok', advertised, commands)
    assert.equal(cap?.controlMethod, '_session/goal')
    assert.deepEqual(cap?.methodActions, ['clear'])
    assert.ok(cap?.actions.includes('set'))
    assert.equal(goalUsesRpc(cap, 'clear'), true)
    assert.equal(goalUsesRpc(cap, 'pause'), false)
    assert.equal(resolveGoalCapability('cursor', null, [{ name: 'compact' }]), null)
  })

  it('maps /goal slash text onto optimistic snapshots', () => {
    assert.equal(goalSlashText('pause'), '/goal pause')
    assert.equal(goalSlashText('set', 'Ship the change'), '/goal Ship the change')
    const set = applyGoalSlash(null, '/goal All tests pass and lint is clean')
    assert.equal(
      set && 'objective' in set ? set.objective : '',
      'All tests pass and lint is clean'
    )
    assert.equal(set && 'status' in set ? set.status : '', 'active')
    const paused = applyGoalSlash(set, '/goal pause')
    assert.equal(paused && 'status' in paused ? paused.status : '', 'paused')
    assert.equal(applyGoalSlash(paused, '/goal clear'), null)
    assert.equal(applyGoalSlash(paused, '/goal status'), undefined)
    assert.deepEqual(goalBannerActions({ objective: 'X', status: 'active' }, capFor(['pause', 'clear'])), [
      'pause',
      'clear'
    ])
  })
})

function capFor(actions: Array<'set' | 'pause' | 'resume' | 'clear'>) {
  return { version: 1, controlMethod: 'slash', actions }
}
