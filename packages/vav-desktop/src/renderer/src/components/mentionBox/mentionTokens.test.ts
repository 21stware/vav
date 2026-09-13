import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  appMentionToken,
  appNameFromToken,
  findComposerPills
} from './mentionTokens.ts'

describe('app tokens', () => {
  it('builds and reads back a bracketed app token', () => {
    const token = appMentionToken('Google Chrome')
    assert.equal(token, '@[Google Chrome]')
    assert.equal(appNameFromToken(token), 'Google Chrome')
  })

  it('sanitizes brackets / newlines / runs of whitespace in the name', () => {
    assert.equal(appMentionToken('  Weird[App]\n name '), '@[Weird App name]')
  })

  it('returns null for non-tokens', () => {
    assert.equal(appNameFromToken('@Chrome'), null)
    assert.equal(appNameFromToken('@[a] extra'), null)
  })
})

describe('findComposerPills', () => {
  it('finds app tokens and file paths, sorted and non-overlapping', () => {
    const text = 'open @[Safari] then edit ./src/app.ts please'
    const pills = findComposerPills(text)
    assert.deepEqual(
      pills.map((p) => `${p.kind}:${p.name}`),
      ['app:Safari', 'file:./src/app.ts']
    )
    // Ranges cover the literal token / path text.
    assert.equal(text.slice(pills[0]!.start, pills[0]!.end), '@[Safari]')
    assert.equal(text.slice(pills[1]!.start, pills[1]!.end), './src/app.ts')
  })

  it('ignores bare words and emails', () => {
    assert.deepEqual(findComposerPills('ping me at hi@example.com about foo'), [])
  })
})
