import { memo, useLayoutEffect, useRef } from 'react'
import { highlightMatches, renderMarkdown, renderMarkdownUncached } from '../lib/markdown'
import { TAIL_PLAIN_TEXT_THRESHOLD } from '../lib/segmenter'

/**
 * One rendered markdown region.
 *
 * Sealed chunks pass `cached` (the default) so the parse happens once and the
 * memo keeps them out of the tick path entirely. The open tail passes
 * `cached={false}` and degrades to plain text past 8 KB, which bounds the
 * per-tick parse cost no matter how long the message grows.
 */
export const MarkdownView = memo(function MarkdownView({
  source,
  highlight,
  cached = true
}: {
  source: string
  highlight?: string
  cached?: boolean
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const plain = !cached && source.length > TAIL_PLAIN_TEXT_THRESHOLD
  const html = plain ? '' : cached ? renderMarkdown(source) : renderMarkdownUncached(source)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element || plain) return
    element.innerHTML = html
    if (highlight) highlightMatches(element, highlight)
  }, [html, highlight, plain])

  if (plain) return <pre className="plain-tail">{source}</pre>
  return <div className="markdown" ref={ref} />
})
