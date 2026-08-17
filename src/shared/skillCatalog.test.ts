import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isDefaultPromptSkill, skillsForPrompt } from './skillCatalog.ts'

describe('default prompt skill catalog', () => {
  it('keeps document and code skills', () => {
    assert.equal(isDefaultPromptSkill('officecli'), true)
    assert.equal(isDefaultPromptSkill('pdf'), true)
    assert.equal(isDefaultPromptSkill('fullstack-dev'), true)
  })

  it('drops demo / art / infra packs from the prompt list', () => {
    assert.equal(isDefaultPromptSkill('algorithmic-art'), false)
    assert.equal(isDefaultPromptSkill('shader-dev'), false)
    assert.equal(isDefaultPromptSkill('mcp-builder'), false)
    assert.equal(isDefaultPromptSkill('gif-sticker'), false)
    assert.equal(isDefaultPromptSkill('webapp-testing'), false)
  })

  it('filters a catalog without deleting the extras', () => {
    const catalog = [{ id: 'officecli' }, { id: 'shader-dev' }, { id: 'docx' }]
    assert.deepEqual(
      skillsForPrompt(catalog).map((s) => s.id),
      ['officecli', 'docx']
    )
  })
})
