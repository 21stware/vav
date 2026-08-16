import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { stripMermaidPreamble } from './mermaidSource.ts'

describe('stripMermaidPreamble', () => {
  it('leaves a bare flowchart header alone', () => {
    const src = 'graph TD\n  A --> B'
    assert.equal(stripMermaidPreamble(src), src)
  })

  it('drops YAML frontmatter so the header is first', () => {
    const src = '---\ntitle: Flow\n---\ngraph TD\n  A --> B'
    assert.equal(stripMermaidPreamble(src), 'graph TD\n  A --> B')
  })

  it('drops init directives and comment lines', () => {
    const src = "%%{init: {'theme': 'dark'}}%%\n%% comment\nsequenceDiagram\n  A->>B: hi"
    assert.equal(stripMermaidPreamble(src), 'sequenceDiagram\n  A->>B: hi')
  })
})
