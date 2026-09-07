import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import {
  entranceStarted,
  markEntranceStarted,
  resetEntranceState,
  visitScene
} from './emptyEntrance.ts'

describe('empty-state entrance scenes', () => {
  beforeEach(() => resetEntranceState())

  it('plays a scene once and never again', () => {
    assert.equal(entranceStarted('session', 'a'), false)
    markEntranceStarted('session', 'a')
    assert.equal(entranceStarted('session', 'a'), true)
    markEntranceStarted('session', 'a')
    assert.equal(entranceStarted('session', 'a'), true)
  })

  it('only remembers the newest scene, so a revisit plays again', () => {
    markEntranceStarted('session', 'a')
    markEntranceStarted('session', 'b')
    assert.equal(entranceStarted('session', 'a'), false)
  })

  it('keeps slots independent', () => {
    markEntranceStarted('session', 'a')
    assert.equal(entranceStarted('panel', 'a'), false)
  })

  it('mints a new visit each time the key comes back', () => {
    const first = visitScene('transcript', 'chat-1')
    assert.equal(visitScene('transcript', 'chat-1'), first)
    const other = visitScene('transcript', 'chat-2')
    assert.notEqual(other, first)
    const back = visitScene('transcript', 'chat-1')
    assert.notEqual(back, first)
    assert.equal(visitScene('transcript', 'chat-1'), back)
  })

  it('tracks visits per surface', () => {
    const held = visitScene('main', 'chat-1')
    visitScene('companion', 'chat-2')
    assert.equal(visitScene('main', 'chat-1'), held)
  })

  it('keeps simultaneous conversation tracks from bumping each other', () => {
    const a = visitScene('transcript:a', 'empty')
    visitScene('transcript:b', 'empty')
    assert.equal(visitScene('transcript:a', 'empty'), a)
    const b = visitScene('transcript:b', 'empty')
    visitScene('transcript:a', 'empty')
    assert.equal(visitScene('transcript:b', 'empty'), b)
  })
})
