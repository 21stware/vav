import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { expandedAfterCollapseAll } from './filesPanelExpand.ts'

describe('expandedAfterCollapseAll', () => {
  it('drops the folder and descendants, keeps siblings and ancestors', () => {
    assert.deepEqual(
      expandedAfterCollapseAll(
        ['/repo', '/repo/src', '/repo/src/lib', '/repo/docs', '/other'],
        '/repo/src'
      ),
      ['/repo', '/repo/docs', '/other']
    )
    assert.deepEqual(expandedAfterCollapseAll(['/repo/src'], '/repo/src'), [])
  })
})
