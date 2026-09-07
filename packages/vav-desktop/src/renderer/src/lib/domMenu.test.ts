import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveMenuView } from './domMenu.ts'

describe('resolveMenuView', () => {
  const items = [
    { id: 'recent', label: 'Recent' },
    {
      id: 'deepseek',
      label: 'DeepSeek',
      submenu: [
        { id: 'flash', label: 'Flash' },
        { id: 'pro', label: 'Pro' }
      ]
    }
  ]

  it('shows the root until a submenu is opened', () => {
    const view = resolveMenuView(items, [])
    assert.equal(view.title, null)
    assert.equal(view.items.length, 2)
    assert.equal(view.items[1]?.label, 'DeepSeek')
  })

  it('drills into a submenu by index', () => {
    const view = resolveMenuView(items, [1])
    assert.equal(view.title, 'DeepSeek')
    assert.deepEqual(
      view.items.map((row) => row.id),
      ['flash', 'pro']
    )
  })

  it('stays put when the index is not a submenu', () => {
    const view = resolveMenuView(items, [0])
    assert.equal(view.title, null)
    assert.equal(view.items[0]?.id, 'recent')
  })
})
