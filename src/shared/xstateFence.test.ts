import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildXstateHostHtml,
  collectXstateEvents,
  isXstateLang,
  parseXstateConfig,
  unwrapXstateSource
} from './xstateFence.ts'

const article = `{
  "id": "article",
  "initial": "draft",
  "states": {
    "draft": { "on": { "SUBMIT": "review" } },
    "review": {
      "initial": "pending",
      "states": {
        "pending": { "on": { "REQUEST_CHANGES": "changes" } },
        "changes": { "on": { "RESUBMIT": "pending" } }
      },
      "on": { "APPROVE": "published", "REJECT": "draft" }
    }
  }
}`

describe('xstate fence', () => {
  it('recognizes fence tags', () => {
    assert.equal(isXstateLang('xstate'), true)
    assert.equal(isXstateLang('XState'), true)
    assert.equal(isXstateLang('statechart'), true)
    assert.equal(isXstateLang('app'), false)
  })

  it('parses JSON machine config and collects events', () => {
    const config = parseXstateConfig(article)
    assert.ok(config)
    assert.equal(config.id, 'article')
    const events = collectXstateEvents(config)
    assert.deepEqual(events.sort(), ['APPROVE', 'REJECT', 'REQUEST_CHANGES', 'RESUBMIT', 'SUBMIT'])
  })

  it('unwraps createMachine(...) wrappers', () => {
    const inner = unwrapXstateSource(`createMachine(${article})`)
    assert.match(inner, /"id": "article"/)
    assert.doesNotMatch(inner, /createMachine/)
  })

  it('builds a host that mounts the official inspector', () => {
    const html = buildXstateHostHtml(article)
    assert.match(html, /<!DOCTYPE html>/i)
    assert.match(html, /id="inspector"/)
    assert.match(html, /@statelyai\/inspect/)
    assert.match(html, /stately\.ai\/registry\/inspect/)
    assert.match(html, /vav-xstate-event/)
  })
})
