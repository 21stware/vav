import { useEffect, useRef } from 'react'
import { MarkdownView } from '../MarkdownView'
import { highlightCode } from '../../lib/highlightCode'
import { parseNotebookBlocks, type PreviewBlock } from '../../lib/previewBlocks'
import { handleClickPickMouseDown, type ClickPickPointer } from '../../lib/clickPick'
import { attachDomPick, updateDomPick } from '../office/pickFromDom'
import { EmptyState } from '../ui'
import { useT } from '../../i18n/useT'
import { CodeBlockCanvas } from './CodeBlockCanvas'

// Descendants (not `>`): sealed chunks use `display: contents` hosts, so block
// nodes are nested under `.markdown-chunk` in the DOM tree.
const MD_PICK_SELECTOR = [
  '.preview-markdown p',
  '.preview-markdown h1',
  '.preview-markdown h2',
  '.preview-markdown h3',
  '.preview-markdown h4',
  '.preview-markdown h5',
  '.preview-markdown h6',
  '.preview-markdown li',
  '.preview-markdown blockquote',
  '.preview-markdown .md-preview-fence',
  '.preview-markdown .md-block',
  '.preview-markdown .table-scroll',
  '.preview-markdown td',
  '.preview-markdown th'
].join(',')

/**
 * Streaming markdown canvas: sealed chunks stay mounted; only the open tail
 * re-parses. Pick mode uses DOM hit-testing (same path as office).
 */
function StreamingMarkdownDocument({
  path,
  text,
  selecting,
  selectedIds,
  onSelectBlock,
  onAskAgent
}: {
  path: string
  text: string
  selecting: boolean
  selectedIds: string[]
  onSelectBlock: (id: string, event?: React.MouseEvent | ClickPickPointer | null, hint?: PreviewBlock) => void
  onAskAgent: (prompt: string, target: PreviewBlock) => void
}): React.JSX.Element {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const onSelectRef = useRef(onSelectBlock)
  onSelectRef.current = onSelectBlock
  const onAskRef = useRef(onAskAgent)
  onAskRef.current = onAskAgent

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const dispose = attachDomPick(root, {
      selecting,
      selectedIds,
      idPrefix: 'md',
      selector: MD_PICK_SELECTOR,
      onPick: (block, event) => {
        onSelectRef.current(block.id, event, block)
      }
    })
    return dispose
    // Attach once; selection chrome updates below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  useEffect(() => {
    updateDomPick(rootRef.current, {
      selecting,
      selectedIds,
      onPick: (block, event) => {
        onSelectRef.current(block.id, event, block)
      }
    })
  }, [selecting, selectedIds])

  useEffect(() => {
    const root = rootRef.current
    if (!root || !selecting) return
    const onContext = (event: MouseEvent): void => {
      const raw = event.target as HTMLElement | null
      if (!raw || !root.contains(raw)) return
      const hit = raw.closest<HTMLElement>('[data-block-id]')
      if (!hit?.dataset.blockId) return
      event.preventDefault()
      event.stopPropagation()
      const id = hit.dataset.blockId
      const textContent = (hit.innerText || hit.textContent || '').replace(/\s+/g, ' ').trim()
      const block: PreviewBlock = {
        id,
        kind: hit.tagName.startsWith('H') ? 'heading' : 'paragraph',
        text: textContent.slice(0, 8000),
        label: textContent.slice(0, 64) || id,
        startLine: 0,
        endLine: 0
      }
      void window.vav.window
        .popupMenu(
          [
            { id: 'copy', label: t('preview.copyBlock') },
            { id: 'analyze', label: t('preview.analyzeBlock') },
            { id: 'refactor', label: t('preview.refactorBlock') }
          ],
          { x: event.clientX, y: event.clientY }
        )
        .then((choice) => {
          if (choice === 'copy') {
            void window.vav.conversations.copyToClipboard(block.text)
            return
          }
          if (choice === 'analyze') {
            onSelectRef.current(block.id, null, block)
            onAskRef.current(t('preview.analyzePrompt'), block)
            return
          }
          if (choice === 'refactor') {
            onSelectRef.current(block.id, null, block)
            onAskRef.current(t('preview.refactorPrompt'), block)
          }
        })
    }
    root.addEventListener('contextmenu', onContext)
    return () => root.removeEventListener('contextmenu', onContext)
  }, [selecting, t])

  return (
    <div
      ref={rootRef}
      className={`preview-document${selecting ? ' selecting' : ''}`}
    >
      <MarkdownView source={text} filePath={path} progressive />
    </div>
  )
}

/**
 * Same rendered document in preview and edit. Edit only enables inspect-style
 * block selection — never a source/code editor or inline cell inputs.
 */
export function DocumentView({
  path,
  text,
  markdown,
  notebook,
  lineOriented = false,
  selecting,
  blocks,
  selectedIds,
  selectedBlocks,
  onSelectBlock,
  onSelectLine,
  onNearEnd,
  onAskAgent
}: {
  path: string
  text: string
  markdown: boolean
  notebook: boolean
  /** Per-line pick (logs) — no paragraph block tree required. */
  lineOriented?: boolean
  selecting: boolean
  blocks: PreviewBlock[]
  selectedIds: string[]
  selectedBlocks: PreviewBlock[]
  onSelectBlock: (id: string, event?: React.MouseEvent | ClickPickPointer | null) => void
  onSelectLine: (line: number, event?: React.MouseEvent | ClickPickPointer | null) => void
  /** Silent windowed fill when the user scrolls near loaded end. */
  onNearEnd?: () => void
  onAskAgent: (prompt: string, target: PreviewBlock) => void
}): React.JSX.Element {
  const t = useT()

  if (markdown) {
    if (!text.trim()) {
      return (
        <EmptyState title={t('preview.emptyFile')} description={t('preview.emptyFileDesc')} />
      )
    }
    // Always stream (sealed chunks + live tail). Block-tree remounts used to
    // flash the whole document on every agent rewrite / window fill.
    return (
      <StreamingMarkdownDocument
        path={path}
        text={text}
        selecting={selecting}
        selectedIds={selectedIds}
        onSelectBlock={onSelectBlock}
        onAskAgent={onAskAgent}
      />
    )
  }

  if (notebook) {
    const cells = parseNotebookBlocks(text)
    if (cells.length === 0) {
      return (
        <EmptyState title={t('preview.emptyFile')} description={t('preview.emptyFileDesc')} />
      )
    }
    return (
      <div className={`preview-document notebook${selecting ? ' selecting' : ''}`}>
        {cells.map((cell) => {
          const selected = selecting && selectedIds.includes(cell.id)
          const body = !cell.language ? (
            <MarkdownView source={cell.text} filePath={path} />
          ) : (
            <pre className="file-viewer-code">
              <code
                className="hljs"
                dangerouslySetInnerHTML={{
                  __html: highlightCode(cell.text, cell.language || 'python')
                }}
              />
            </pre>
          )
          if (!selecting) {
            return (
              <div key={cell.id} className="preview-notebook-cell">
                {body}
              </div>
            )
          }
          return (
            <div
              key={cell.id}
              className={`preview-notebook-cell preview-select-region${selected ? ' selected' : ''}`}
              onMouseDown={(event) =>
                handleClickPickMouseDown(event, () => onSelectBlock(cell.id, null))
              }
              onContextMenu={(event) => {
                event.preventDefault()
                void window.vav.window
                  .popupMenu(
                    [
                      { id: 'copy', label: t('preview.copyBlock') },
                      { id: 'analyze', label: t('preview.analyzeBlock') },
                      { id: 'refactor', label: t('preview.refactorBlock') }
                    ],
                    { x: event.clientX, y: event.clientY }
                  )
                  .then((id) => {
                    if (id === 'copy') void window.vav.conversations.copyToClipboard(cell.text)
                    if (id === 'analyze') onAskAgent(t('preview.analyzePrompt'), cell)
                    if (id === 'refactor') onAskAgent(t('preview.refactorPrompt'), cell)
                  })
              }}
            >
              {body}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <CodeBlockCanvas
      path={path}
      text={text}
      lineOriented={lineOriented}
      selecting={selecting}
      blocks={blocks}
      selectedIds={selectedIds}
      selectedBlocks={selectedBlocks}
      onSelectBlock={onSelectBlock}
      onSelectLine={onSelectLine}
      onNearEnd={onNearEnd}
      onAskAgent={onAskAgent}
    />
  )
}
