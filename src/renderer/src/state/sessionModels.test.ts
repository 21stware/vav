import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  builtinCatalogVendorId,
  chatHostPickerModels,
  coercedChatHostModel,
  defaultModelSettingsPatch,
  defaultThinkingSettingsPatch,
  nextSteppedModelId
} from './sessionModels.ts'

describe('nextSteppedModelId', () => {
  it('wraps, falls back to the first id, and no-ops a singleton', () => {
    const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    assert.equal(nextSteppedModelId(list, 'b', 1), 'c')
    assert.equal(nextSteppedModelId(list, 'c', 1), 'a')
    assert.equal(nextSteppedModelId(list, 'a', -1), 'c')
    assert.equal(nextSteppedModelId(list, 'missing', 1), 'a')
    assert.equal(nextSteppedModelId([{ id: 'only' }], 'only', 1), null)
    assert.equal(nextSteppedModelId([], 'a', 1), null)
  })
})

describe('chatHostPickerModels / coercedChatHostModel', () => {
  it('resolves builtin vendor from the vav catalog key', () => {
    const vendor = builtinCatalogVendorId(
      { vav: { endpoint: 'https://api.deepseek.com' } },
      null,
      'https://api.openai.com/v1'
    )
    assert.equal(vendor, 'deepseek')
    const byAccount = builtinCatalogVendorId(
      { 'vav:acc': { endpoint: 'https://openrouter.ai/api/v1' } },
      'acc',
      undefined
    )
    assert.equal(byAccount, 'openrouter')
  })

  it('prefers the live catalogue and filters disabled ids', () => {
    const { list, vendorId } = chatHostPickerModels({
      cliHost: null,
      catalog: {
        'vav:deepseek': {
          models: [{ id: 'keep', label: 'Keep' }, { id: 'drop', label: 'Drop' }],
          endpoint: 'https://api.deepseek.com'
        }
      },
      customModels: [],
      defaultModel: 'keep',
      disabledAgentModels: { 'vav:deepseek': ['drop'] },
      apiEndpoint: 'https://api.deepseek.com'
    })
    assert.equal(vendorId, 'deepseek')
    assert.deepEqual(
      list.map((m) => m.id),
      ['keep']
    )
  })

  it('coerces an empty model onto the host catalogue', () => {
    const next = coercedChatHostModel({
      host: 'claude',
      currentModel: '',
      customModels: [],
      vavDefaultModel: 'x',
      catalogue: [{ id: 'sonnet', label: 'Sonnet' }]
    })
    assert.equal(next, 'sonnet')
    assert.equal(
      coercedChatHostModel({
        host: 'claude',
        currentModel: 'opus',
        customModels: [],
        vavDefaultModel: 'x',
        catalogue: [
          { id: 'sonnet', label: 'Sonnet' },
          { id: 'opus', label: 'Opus' }
        ]
      }),
      'opus'
    )
  })
})

describe('defaultModelSettingsPatch / defaultThinkingSettingsPatch', () => {
  it('writes the builtin default only when the picker actually changed', () => {
    assert.deepEqual(
      defaultModelSettingsPatch(null, 'sonnet', { defaultModel: 'opus' }),
      { defaultModel: 'sonnet' }
    )
    assert.equal(defaultModelSettingsPatch(null, 'opus', { defaultModel: 'opus' }), null)
    assert.equal(defaultModelSettingsPatch(null, '', { defaultModel: 'opus' }), null)
  })

  it('patches the CLI host map and keeps sibling defaults', () => {
    assert.deepEqual(
      defaultModelSettingsPatch('claude', 'sonnet', {
        defaultAgentModels: { claude: 'opus', cursor: 'composer' }
      }),
      { defaultAgentModels: { claude: 'sonnet', cursor: 'composer' } }
    )
    assert.equal(
      defaultModelSettingsPatch('claude', 'opus', { defaultAgentModels: { claude: 'opus' } }),
      null
    )
    assert.deepEqual(defaultModelSettingsPatch('cursor', 'composer', {}), {
      defaultAgentModels: { cursor: 'composer' }
    })
  })

  it('writes thinking only when a new non-empty level is chosen', () => {
    assert.deepEqual(defaultThinkingSettingsPatch('high', 'medium'), {
      defaultThinkingLevel: 'high'
    })
    assert.equal(defaultThinkingSettingsPatch('high', 'high'), null)
    assert.equal(defaultThinkingSettingsPatch('', 'high'), null)
    assert.equal(defaultThinkingSettingsPatch(null, 'high'), null)
  })
})
