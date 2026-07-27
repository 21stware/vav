import { memo, useLayoutEffect, useRef } from 'react'
import {
  extractBlockPlainText,
  highlightMatches,
  renderMarkdown,
  renderMarkdownUncached
} from '../lib/markdown'
import { TAIL_PLAIN_TEXT_THRESHOLD } from '../lib/segmenter'
import { tt } from '../i18n/useT'

/**
 * One rendered markdown region.
 *
 * Sealed chunks pass `cached` (the default) so the parse happens once and the
 * memo keeps them out of the tick path entirely. The open tail passes
 * `cached={false}` and degrades to plain text past 8 KB, which bounds the
 * per-tick parse cost no matter how long the message grows.
 *
 * Code blocks and tables carry Copy / Save as file chrome (main-chat-search).
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
  return (
    <div
      className="markdown"
      ref={ref}
      onClick={(event) => {
        const target = event.target as HTMLElement | null
        const button = target?.closest<HTMLButtonElement>('[data-md-action]')
        if (!button) return
        const block = button.closest<HTMLElement>('.md-block')
        if (!block) return
        event.preventDefault()
        void handleBlockAction(button.dataset.mdAction, block, button)
      }}
    />
  )
})

async function handleBlockAction(
  action: string | undefined,
  block: HTMLElement,
  button: HTMLButtonElement
): Promise<void> {
  const text = extractBlockPlainText(block)
  const filename = block.dataset.filename || 'snippet.txt'
  if (action === 'copy') {
    await window.vav.conversations.copyToClipboard(text)
    const previous = button.textContent
    button.textContent = tt('common.copied')
    button.dataset.copied = 'true'
    window.setTimeout(() => {
      button.textContent = previous
      delete button.dataset.copied
    }, 1200)
    return
  }
  if (action === 'save') {
    await window.vav.files.saveAs(filename, text)
  }
}
