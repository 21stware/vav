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
  parseGrokSessionConfig,
  parseSlashDraft,
  patchAcpConfigOption,
  patchAcpSessionMode,
  acpSlashMenuMatches
} from './acpSession.ts'

describe('parseGrokSessionConfig', () => {
  it('reads effort as thinking, not plan/agent modes', () => {
    const parsed = parseGrokSessionConfig({
      options: [
        { id: 'grok-4.5', category: 'model', label: 'Grok 4.5', selected: true },
        { id: 'low', category: 'mode', label: 'Low Effort', selected: false },
        { id: 'medium', category: 'mode', label: 'Medium Effort', selected: true },
        { id: 'high', category: 'mode', label: 'High Effort', selected: false }
      ]
    })
    assert.deepEqual(parsed.thinkingLevels, ['low', 'medium', 'high'])
    assert.equal(parsed.currentThinking, 'medium')
    assert.equal(parsed.currentModelId, 'grok-4.5')
  })
})

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
