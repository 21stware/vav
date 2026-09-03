import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { makeListKeyDown } from './githubPanelNav.ts'

function press(
  handler: ReturnType<typeof makeListKeyDown>,
  key: string
): { prevented: boolean } {
  let prevented = false
  handler({
    key,
    preventDefault: () => {
      prevented = true
    }
  })
  return { prevented }
}

describe('makeListKeyDown', () => {
  it('moves, jumps, and activates the focused row', () => {
    let index = 1
    const selected: number[] = []
    const previewed: number[] = []
    const handler = makeListKeyDown({
      count: 4,
      setIndex: (updater) => {
        index = updater(index)
      },
      selectAt: (next) => selected.push(next),
      previewAt: (next) => previewed.push(next),
      scrollParent: { current: null },
      rowAttr: 'data-github-row'
    })

    assert.equal(press(handler, 'ArrowDown').prevented, true)
    assert.equal(index, 2)
    assert.deepEqual(selected, [2])

    assert.equal(press(handler, 'Home').prevented, true)
    assert.equal(index, 0)
    assert.deepEqual(selected, [2, 0])

    assert.equal(press(handler, 'End').prevented, true)
    assert.equal(index, 3)
    assert.deepEqual(selected, [2, 0, 3])

    press(handler, 'Enter')
    assert.deepEqual(previewed, [3])
  })

  it('ignores keys when the list is empty', () => {
    let called = false
    const handler = makeListKeyDown({
      count: 0,
      setIndex: () => {
        called = true
      },
      selectAt: () => {
        called = true
      },
      scrollParent: { current: null },
      rowAttr: 'data-github-row'
    })
    press(handler, 'ArrowDown')
    assert.equal(called, false)
  })
})
