import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  builtinCatalogVendorId,
  chatHostPickerModels,
  coercedChatHostModel,
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
