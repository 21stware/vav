import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ToolCallBlock } from '@shared/types'
import {
  classifyNetworkError,
  outcomeFor,
  parseFetchedPage,
  pickUrl,
  presentToolArgs,
  prettyToolInput,
  shouldShowTechnical
} from './toolPresentation.ts'

function block(
  partial: Partial<ToolCallBlock> & Pick<ToolCallBlock, 'tool' | 'status'>
): Pick<ToolCallBlock, 'tool' | 'output' | 'status'> {
  return {
    tool: partial.tool,
    status: partial.status,
    output: partial.output ?? ''
  }
}

describe('presentToolArgs', () => {
  it('lifts the URL from the summary when input is only format', () => {
    const { facts, extraArgs } = presentToolArgs(
      'web_fetch',
      '{"format":"markdown"}',
      'https://raw.githubusercontent.com/maziyarpanahi/openmed/main/README.md'
    )
    assert.deepEqual(facts, [
      {
        kind: 'url',
        value: 'https://raw.githubusercontent.com/maziyarpanahi/openmed/main/README.md'
      }
    ])
    assert.equal(extraArgs.format, 'markdown')
  })

  it('hides implementation keys and keeps the URL', () => {
    const { facts, extraArgs } = presentToolArgs(
      'web_fetch',
      JSON.stringify({
        url: 'https://example.com/doc',
        format: 'markdown',
        extract: 'auto',
        max_chars: 12000
      }),
      ''
    )
    assert.deepEqual(facts, [{ kind: 'url', value: 'https://example.com/doc' }])
    assert.equal(extraArgs.format, 'markdown')
    assert.equal(extraArgs.extract, 'auto')
    assert.equal(extraArgs.max_chars, 12000)
  })

  it('surfaces a search query and site, not the result cap', () => {
    const { facts, extraArgs } = presentToolArgs(
      'web_search',
      JSON.stringify({ query: 'openmed readme', site: 'github.com', num_results: 8 }),
      ''
    )
    assert.deepEqual(facts, [
      { kind: 'query', value: 'openmed readme' },
      { kind: 'site', value: 'github.com' }
    ])
    assert.equal(extraArgs.num_results, 8)
  })

  it('falls back to the collapsed summary as the search query', () => {
    const { facts } = presentToolArgs('web_search', '{}', 'openmed readme')
    assert.deepEqual(facts, [{ kind: 'query', value: 'openmed readme' }])
  })

  it('surfaces a subtask description and agent, not the prompt', () => {
    const { facts, extraArgs } = presentToolArgs(
      'task',
      JSON.stringify({
        description: 'Explore repo structure',
        agent: 'explore',
        prompt: 'Walk the tree and summarize the architecture'
      }),
      ''
    )
    assert.deepEqual(facts, [
      { kind: 'name', value: 'Explore repo structure' },
      { kind: 'agent', value: 'explore' }
    ])
    assert.equal(extraArgs.prompt, 'Walk the tree and summarize the architecture')
  })
})

describe('pickUrl', () => {
  it('strips trailing punctuation copied from a sentence', () => {
    assert.equal(pickUrl({}, 'See https://example.com/a).'), 'https://example.com/a')
  })
})

describe('outcomeFor', () => {
  it('explains a failed fetch without dumping I/O', () => {
    const outcome = outcomeFor(
      block({
        tool: 'web_fetch',
        status: 'error',
        output: 'web_fetch failed for https://example.com: getaddrinfo ENOTFOUND example.com'
      })
    )
    assert.equal(outcome.kind, 'error')
    if (outcome.kind !== 'error') return
    assert.equal(outcome.headline, 'tool.detail.failedFetch')
    assert.equal(outcome.detailKey, 'tool.error.host')
    assert.equal(outcome.detailText, undefined)
  })

  it('uses a page-specific empty line when a fetch returns nothing', () => {
    const outcome = outcomeFor(block({ tool: 'web_fetch', status: 'completed', output: '' }))
    assert.deepEqual(outcome, { kind: 'empty', headline: 'tool.detail.emptyFetch' })
  })

  it('keeps successful output as the body', () => {
    const outcome = outcomeFor(
      block({ tool: 'load_skill', status: 'completed', output: '# pptx\nUse this skill.' })
    )
    assert.deepEqual(outcome, { kind: 'body', text: '# pptx\nUse this skill.' })
  })

  it('stays quiet while the tool is still running', () => {
    const outcome = outcomeFor(block({ tool: 'web_fetch', status: 'executing', output: '' }))
    assert.deepEqual(outcome, { kind: 'none' })
  })
})

describe('classifyNetworkError', () => {
  it('maps common network failures', () => {
    assert.equal(classifyNetworkError('getaddrinfo ENOTFOUND raw.githubusercontent.com'), 'tool.error.host')
    assert.equal(classifyNetworkError('request timed out after 15000ms'), 'tool.error.timeout')
    assert.equal(classifyNetworkError('connect ECONNREFUSED 127.0.0.1:443'), 'tool.error.refused')
    assert.equal(classifyNetworkError('HTTP 404 Not Found'), 'tool.error.missing')
    assert.equal(classifyNetworkError('Blocked: private address'), 'tool.error.blocked')
  })
})

describe('screenshot conversation: failed raw README fetch', () => {
  const input = '{"format":"markdown","url":"https://raw.githubusercontent.com/maziyarpanahi/openmed/main/README.md"}'
  const summary = 'https://raw.githubusercontent.com/maziyarpanahi/openmed/main/README.md'

  it('shows the full URL and a human failure, not Input/Output JSON', () => {
    const { facts, extraArgs } = presentToolArgs('web_fetch', input, summary)
    assert.deepEqual(facts, [{ kind: 'url', value: summary }])
    assert.equal(shouldShowTechnical(extraArgs, ''), false)
    const outcome = outcomeFor({ tool: 'web_fetch', status: 'error', output: '' })
    assert.equal(outcome.kind, 'error')
    if (outcome.kind !== 'error') return
    assert.equal(outcome.headline, 'tool.detail.failedFetch')
    assert.equal(outcome.detailKey, undefined)
    assert.equal(outcome.detailText, undefined)
  })
})

describe('parseFetchedPage', () => {
  it('keeps the title and URL, drops extract/chars jargon', () => {
    const parsed = parseFetchedPage(
      [
        '# OpenMed',
        'final_url: https://github.com/maziyarpanahi/openmed',
        'content_type: text/html',
        'extracted: markdown',
        'chars: 1200 (truncated=true)',
        '',
        '---',
        '',
        'Local-first healthcare AI.'
      ].join('\n')
    )
    assert.deepEqual(parsed, {
      title: 'OpenMed',
      url: 'https://github.com/maziyarpanahi/openmed',
      body: 'Local-first healthcare AI.'
    })
  })

  it('treats a CLI dump without meta as the page body', () => {
    const parsed = parseFetchedPage('GitHub - maziyarpanahi/openmed: Local-first healthcare AI')
    assert.deepEqual(parsed, { body: 'GitHub - maziyarpanahi/openmed: Local-first healthcare AI' })
  })
})

describe('technical disclosure', () => {
  it('pretty-prints JSON and only opens when extras remain', () => {
    assert.equal(prettyToolInput('{"format":"markdown"}'), '{\n  "format": "markdown"\n}')
    const presented = presentToolArgs('web_fetch', '{"url":"https://a.com"}', '')
    assert.equal(shouldShowTechnical(presented.extraArgs, ''), false)
    const withFormat = presentToolArgs('web_fetch', '{"url":"https://a.com","format":"markdown"}', '')
    assert.equal(shouldShowTechnical(withFormat.extraArgs, ''), false)
    assert.equal(shouldShowTechnical({ custom: 1 }, ''), true)
    assert.equal(shouldShowTechnical({}, 'web_fetch failed for https://a.com: boom'), true)
  })
})
