import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { sourceHasOpenDiagramFence } from './diagramFence.ts'

describe('sourceHasOpenDiagramFence', () => {
  it('is false for ordinary markdown', () => {
    assert.equal(sourceHasOpenDiagramFence('Hello\n\nA paragraph.'), false)
  })

  it('is true while a mermaid fence is still open', () => {
    assert.equal(sourceHasOpenDiagramFence('```mermaid\ngraph TD\n  A-->B'), true)
  })

  it('is true for vega-lite / graphviz / erd open fences', () => {
    assert.equal(sourceHasOpenDiagramFence('```vega-lite\n{\n  "mark": "bar"'), true)
    assert.equal(sourceHasOpenDiagramFence('```dot\ndigraph G {\n  a -> b'), true)
    assert.equal(sourceHasOpenDiagramFence('```erd\nerDiagram\n  A ||--o{ B'), true)
  })

  it('is false once the diagram fence closes', () => {
    assert.equal(
      sourceHasOpenDiagramFence('```mermaid\ngraph TD\n  A-->B\n```\n'),
      false
    )
  })

  it('is false for an open non-diagram fence', () => {
    assert.equal(sourceHasOpenDiagramFence('```ts\nconst x = 1'), false)
  })

  it('ignores a closed diagram when a later code fence is open', () => {
    const src = '```mermaid\ngraph TD\n  A-->B\n```\n\n```ts\nconst x ='
    assert.equal(sourceHasOpenDiagramFence(src), false)
  })

  it('treats matching tildes as a close', () => {
    assert.equal(sourceHasOpenDiagramFence('~~~mermaid\ngraph TD\nA\n~~~'), false)
    assert.equal(sourceHasOpenDiagramFence('~~~mermaid\ngraph TD\nA'), true)
  })
})
