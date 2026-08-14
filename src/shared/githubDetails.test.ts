import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { convertGfmTables, renderGithubDetails, renderGithubTables, stripHtmlComments } from './githubDetails.ts'

describe('convertGfmTables', () => {
  it('turns a Cloudflare-style status grid into an HTML table', () => {
    const src = [
      '| Status | Name | Preview URL |',
      '| -|-|-|',
      '| ✅ Deployment successful! | origin | <a href="https://example.com">Commit Preview URL</a> |'
    ].join('\n')
    const html = convertGfmTables(src)
    assert.match(html, /<table>/)
    assert.match(html, /<th>Status<\/th>/)
    assert.match(html, /origin/)
    assert.match(html, /<a href="https:\/\/example.com">/)
    assert.doesNotMatch(html, /^\|/m)
  })

  it('does not treat HTML table markup as a GFM pipe row', () => {
    const src = '<td>foo | bar</td>'
    assert.equal(convertGfmTables(src), src)
  })
})

function fakeMd(src: string): string {
  return src
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .join('')
}

describe('renderGithubDetails', () => {
  it('keeps disclosure body inside <details>, not after it', () => {
    const src = [
      'Lead paragraph about the bug.',
      '',
      '<details>',
      '<summary>Prompt for agents</summary>',
      '',
      '```text',
      'Fix BinaryOpenViews.tsx',
      '```',
      '',
      '</details>',
      '',
      'Afterword.'
    ].join('\n')
    const html = renderGithubDetails(src, fakeMd)
    const detailsAt = html.indexOf('<details')
    const closeAt = html.indexOf('</details>')
    const promptAt = html.indexOf('Fix BinaryOpenViews.tsx')
    assert.ok(detailsAt >= 0)
    assert.ok(promptAt > detailsAt)
    assert.ok(promptAt < closeAt)
    assert.ok(html.indexOf('Lead paragraph') < detailsAt)
    assert.ok(html.indexOf('Afterword') > closeAt)
    assert.match(html, /github-details-prompt/)
  })

  it('starts collapsed even if the source had open', () => {
    const html = renderGithubDetails(
      '<details open>\n<summary>Notes</summary>\n\nsecret\n\n</details>',
      fakeMd
    )
    assert.doesNotMatch(html, /<details[^>]*\bopen\b/i)
    assert.match(html, /secret/)
  })
})

describe('stripHtmlComments', () => {
  it('drops bot metadata comments', () => {
    const src = '<!-- devin-review-comment {"id":"x"} -->\n\nVisible'
    assert.equal(stripHtmlComments(src).trim(), 'Visible')
  })
})

describe('renderGithubTables', () => {
  it('keeps nested HTML tables intact across blank lines', () => {
    const src = [
      '<table>',
      '<tr><th>Column 1</th><th>Column 2</th></tr>',
      '',
      '<tr><td>Data 1</td><td>Data 2</td></tr>',
      '<tr><td>Data 3</td><td>',
      '<table>',
      '<tr><th>Nested Col 1</th><th>Nested Col 2</th></tr>',
      '<tr><td>Nested Data 1</td><td>Nested Data 2</td></tr>',
      '</table>',
      '</td></tr>',
      '</table>'
    ].join('\n')
    const html = renderGithubTables(src, fakeMd)
    assert.equal(html.match(/<table/g)?.length, 2)
    assert.match(html, /Nested Col 1/)
    assert.match(html, /Data 3/)
    const outerOpen = html.indexOf('<table')
    const innerOpen = html.indexOf('<table', outerOpen + 1)
    const innerClose = html.indexOf('</table>')
    const outerClose = html.lastIndexOf('</table>')
    assert.ok(innerOpen > outerOpen)
    assert.ok(innerClose > innerOpen)
    assert.ok(outerClose > innerClose)
  })

  it('converts a GFM table nested inside an HTML cell', () => {
    const src = [
      '<table><tr><td>',
      '| Nested Col 1 | Nested Col 2 |',
      '| --- | --- |',
      '| Nested Data 1 | Nested Data 2 |',
      '</td></tr></table>'
    ].join('\n')
    const html = renderGithubTables(src, fakeMd)
    assert.match(html, /<th>Nested Col 1<\/th>/)
    assert.match(html, /Nested Data 1/)
    assert.ok((html.match(/<table/g)?.length ?? 0) >= 2)
  })

  it('renders markdown links inside a Cloudflare status cell', () => {
    const src = [
      '| Status |',
      '| --- |',
      '| [View logs](https://dash.cloudflare.com/builds/abc) |'
    ].join('\n')
    const html = renderGithubTables(src, fakeMd, (text) =>
      text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    )
    assert.match(html, /<a href="https:\/\/dash.cloudflare.com\/builds\/abc">View logs<\/a>/)
    assert.doesNotMatch(html, /\[View logs\]/)
  })
})
