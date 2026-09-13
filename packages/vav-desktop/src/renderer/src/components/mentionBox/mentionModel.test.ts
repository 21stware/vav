import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyMention,
  atomicBackspace,
  atomicCaretTarget,
  atomicDelete,
  findMentions,
  getActiveMention,
  mentionContaining,
  mentionSpanEnd,
  segmentText,
  type MentionOptions
} from './mentionModel.ts'

/** Caret marker helper: "hi @ma|ya" → { text, caret }. */
function cursor(marked: string): { text: string; caret: number } {
  const caret = marked.indexOf('|')
  if (caret < 0) throw new Error('missing | caret marker')
  return { text: marked.slice(0, caret) + marked.slice(caret + 1), caret }
}

describe('findMentions', () => {
  it('finds a simple mention after whitespace and at start', () => {
    assert.deepEqual(findMentions('hi @maya there'), [
      { start: 3, end: 8, trigger: '@', name: 'maya' }
    ])
    assert.deepEqual(findMentions('@maya hi'), [{ start: 0, end: 5, trigger: '@', name: 'maya' }])
  })

  it('finds multiple mentions', () => {
    const m = findMentions('@a and @b')
    assert.deepEqual(
      m.map((x) => x.name),
      ['a', 'b']
    )
  })

  it('does not treat an email-style @ as a mention', () => {
    assert.deepEqual(findMentions('mail me at hi@example.com'), [])
  })

  it('opens after brackets and quotes', () => {
    assert.equal(findMentions('(@maya)')[0]?.name, 'maya')
    assert.equal(findMentions('"@maya"')[0]?.name, 'maya')
  })

  it('respects a roster matcher that shortens the greedy run', () => {
    const opts: MentionOptions = {
      matchName: (run) => {
        for (const name of ['maya', 'max']) if (run.startsWith(name)) return name
        return null
      }
    }
    // "@mayaXY" → mention "maya", trailing "XY" stays plain text.
    assert.deepEqual(findMentions('@mayaXY', opts), [
      { start: 0, end: 5, trigger: '@', name: 'maya' }
    ])
    assert.deepEqual(findMentions('@nobody', opts), [])
  })
})

describe('getActiveMention (pretext detection)', () => {
  it('is active right after the trigger with an empty query', () => {
    const { text, caret } = cursor('hi @|')
    assert.deepEqual(getActiveMention(text, caret), { start: 3, trigger: '@', query: '' })
  })

  it('returns the query up to the caret even mid-token', () => {
    const { text, caret } = cursor('hi @ma|ya')
    assert.deepEqual(getActiveMention(text, caret), { start: 3, trigger: '@', query: 'ma' })
  })

  it('is inactive when a space separates the trigger and caret', () => {
    const { text, caret } = cursor('hi @maya |')
    assert.equal(getActiveMention(text, caret), null)
  })

  it('is inactive with no trigger to the left', () => {
    const { text, caret } = cursor('hello wor|ld')
    assert.equal(getActiveMention(text, caret), null)
  })

  it('is inactive for email @ (bad boundary)', () => {
    const { text, caret } = cursor('hi@ex|ample')
    assert.equal(getActiveMention(text, caret), null)
  })
})

describe('applyMention — full-span replacement (MM-57320 guard)', () => {
  it('replaces the whole token when caret is mid-token, not just the pretext', () => {
    // Caret after "ma"; must not leave "ya" dangling.
    const { text, caret } = cursor('hi @ma|ya!')
    const active = getActiveMention(text, caret)
    assert.ok(active)
    const res = applyMention(text, active.start, '@maya ')
    assert.equal(res.value, 'hi @maya !')
    assert.equal(res.caret, 'hi @maya '.length)
  })

  it('preserves text after the token', () => {
    const text = 'ping @m and go'
    const active = getActiveMention(text, 7) // after "@m"
    assert.ok(active)
    // Caller omits the trailing space here since the source already has one.
    const res = applyMention(text, active.start, '@maya')
    assert.equal(res.value, 'ping @maya and go')
  })

  it('mentionSpanEnd covers the full greedy run', () => {
    assert.equal(mentionSpanEnd('hi @maya!', 3), 8)
  })
})

describe('segmentText', () => {
  it('splits into ordered text / mention runs', () => {
    const text = 'hi @maya and @max!'
    const segs = segmentText(text, findMentions(text))
    assert.deepEqual(
      segs.map((s) => `${s.kind}:${s.text}`),
      ['text:hi ', 'mention:@maya', 'text: and ', 'mention:@max', 'text:!']
    )
  })
})

describe('atomic caret + delete', () => {
  const text = 'hi @maya!'
  const mentions = findMentions(text) // @maya at [3,8)

  it('backspace at the right edge deletes the whole mention', () => {
    assert.deepEqual(atomicBackspace(8, 8, mentions), { start: 3, end: 8 })
  })

  it('backspace elsewhere falls through to native', () => {
    assert.equal(atomicBackspace(9, 9, mentions), null)
    assert.equal(atomicBackspace(3, 3, mentions), null) // at left edge → native
  })

  it('backspace with a ranged selection falls through', () => {
    assert.equal(atomicBackspace(3, 8, mentions), null)
  })

  it('delete at the left edge removes the whole mention', () => {
    assert.deepEqual(atomicDelete(3, 3, mentions), { start: 3, end: 8 })
  })

  it('arrow-left jumps to the mention start when entering from the right', () => {
    assert.equal(atomicCaretTarget(8, 'left', mentions), 3)
    assert.equal(atomicCaretTarget(9, 'left', mentions), null)
  })

  it('arrow-right jumps to the mention end when entering from the left', () => {
    assert.equal(atomicCaretTarget(3, 'right', mentions), 8)
    assert.equal(atomicCaretTarget(0, 'right', mentions), null)
  })

  it('mentionContaining finds a strictly-inside caret', () => {
    assert.equal(mentionContaining(mentions, 5)?.name, 'maya')
    assert.equal(mentionContaining(mentions, 3), null)
    assert.equal(mentionContaining(mentions, 8), null)
  })
})
