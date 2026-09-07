import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseHTML } from 'linkedom'
import {
  ensureStableBlockIds,
  findDeepestMatch,
  syncSelectedClasses
} from './pickFromDom.ts'

const LEAF = 'p, h1, h2, h3, li, td, th'

function mount(html: string): HTMLElement {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`)
  return document.body as unknown as HTMLElement
}

describe('pickFromDom — deepest leaf + empty cells', () => {
  it('assigns stable ids and prefers the deepest match', () => {
    const root = mount(
      `<table><tr><td><p>inner</p></td></tr></table><p>after</p>`
    )
    ensureStableBlockIds(root, LEAF, 'dom')
    const inner = root.querySelector('p') as HTMLElement
    const td = root.querySelector('td') as HTMLElement
    assert.ok(inner.dataset.blockId)
    assert.ok(td.dataset.blockId)
    const hit = findDeepestMatch(root, inner, LEAF)
    assert.equal(hit, inner)
  })

  it('keeps empty table cells as pick targets', () => {
    const root = mount(
      `<table><tr><td></td><td><p></p></td></tr></table>`
    )
    ensureStableBlockIds(root, LEAF, 'dom')
    const cells = Array.from(root.querySelectorAll('td')) as HTMLElement[]
    assert.equal(cells.length, 2)
    for (const cell of cells) {
      assert.ok(cell.dataset.blockId, 'empty td must receive a data-block-id')
      assert.ok(cell.classList.contains('office-pick-target'))
    }
    const emptyP = root.querySelector('p') as HTMLElement
    const promoted = findDeepestMatch(root, emptyP, LEAF)
    assert.ok(promoted)
  })

  it('paints only selected leaf ids', () => {
    const root = mount(`<p>one</p><p>two</p>`)
    ensureStableBlockIds(root, LEAF, 'dom')
    const [a, b] = Array.from(root.querySelectorAll('p')) as HTMLElement[]
    syncSelectedClasses(root, [a.dataset.blockId!])
    assert.equal(a.classList.contains('selected'), true)
    assert.equal(b.classList.contains('selected'), false)
  })
})
