import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  inferModalitiesFromId,
  parseLiveModalities,
  parseModalityArrow,
  resolveModelModalities
} from './modelModalities.ts'

describe('parseLiveModalities', () => {
  it('reads OpenRouter architecture lists', () => {
    assert.deepEqual(
      parseLiveModalities({
        id: 'openai/gpt-4o',
        architecture: {
          input_modalities: ['text', 'image', 'file'],
          output_modalities: ['text']
        }
      }),
      { input: ['text', 'image'], output: ['text'] }
    )
  })

  it('reads a modality arrow string', () => {
    assert.deepEqual(parseModalityArrow('text+image->text'), {
      input: ['text', 'image'],
      output: ['text']
    })
    assert.deepEqual(parseLiveModalities({ modality: 'text+audio → text+audio' }), {
      input: ['text', 'audio'],
      output: ['text', 'audio']
    })
  })

  it('returns nothing for a DeepSeek-style id-only row', () => {
    assert.deepEqual(parseLiveModalities({ id: 'deepseek-v4-flash-vision-exp', object: 'model' }), {})
  })
})

describe('inferModalitiesFromId', () => {
  it('marks DeepSeek vision as image-in, text-out', () => {
    assert.deepEqual(inferModalitiesFromId('deepseek-v4-flash-vision-exp'), {
      input: ['text', 'image'],
      output: ['text']
    })
  })

  it('keeps DeepSeek chat ids text-only', () => {
    assert.deepEqual(inferModalitiesFromId('deepseek-v4-flash'), {
      input: ['text'],
      output: ['text']
    })
    assert.deepEqual(inferModalitiesFromId('deepseek-v4-pro'), {
      input: ['text'],
      output: ['text']
    })
  })
})

describe('resolveModelModalities', () => {
  it('prefers live fields, then catalog, then the id', () => {
    assert.deepEqual(
      resolveModelModalities({ id: 'x', input: ['image'], output: ['text'] }),
      { input: ['image'], output: ['text'] }
    )
    assert.deepEqual(
      resolveModelModalities({ id: 'deepseek-v4-pro' }, ['text']),
      { input: ['text'], output: ['text'] }
    )
    assert.deepEqual(resolveModelModalities({ id: 'deepseek-v4-flash-vision-exp' }), {
      input: ['text', 'image'],
      output: ['text']
    })
  })
})
