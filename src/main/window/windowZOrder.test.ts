import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { appZOrderWindowIds, windowIsInPlay } from './windowZOrder.ts'

describe('windowIsInPlay', () => {
  it('counts visible or minimized shells and ignores destroyed ones', () => {
    assert.equal(windowIsInPlay({ visible: true }), true)
    assert.equal(windowIsInPlay({ minimized: true }), true)
    assert.equal(windowIsInPlay({ visible: false, minimized: false }), false)
    assert.equal(windowIsInPlay({ missing: true, visible: true }), false)
    assert.equal(windowIsInPlay({ destroyed: true, visible: true }), false)
  })
})

describe('appZOrderWindowIds', () => {
  it('stacks main, unfocused Quick Chats, focused Quick Chat, then Settings', () => {
    assert.deepEqual(
      appZOrderWindowIds({
        mainId: 1,
        quickChatIds: [10, 11],
        settingsId: 99,
        focusedId: 11
      }),
      [1, 10, 11, 99]
    )
  })

  it('omits missing layers and does not special-case a focused main window', () => {
    assert.deepEqual(
      appZOrderWindowIds({
        mainId: 1,
        quickChatIds: [],
        settingsId: null,
        focusedId: 1
      }),
      [1]
    )
    assert.deepEqual(
      appZOrderWindowIds({
        mainId: null,
        quickChatIds: [10],
        settingsId: 99,
        focusedId: null
      }),
      [10, 99]
    )
  })
})
