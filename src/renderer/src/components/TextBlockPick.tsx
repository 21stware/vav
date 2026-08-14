import { useMemo, useState, type ReactNode } from 'react'
import type { PreviewBlock } from '@shared/previewBlock'
import { useSessionStore } from '../state/sessionStore'
import { applyBlockPick, selectedBlockIdsForPath } from '../lib/applyBlockPick'
import { handleClickPickMouseDown } from '../lib/clickPick'
import { blockAtLine, findBlockById, parentBlockOf } from '../lib/previewBlocks'
import { useT } from '../i18n/useT'

function covers(block: PreviewBlock, line: number): boolean {
  return line >= block.startLine && line <= block.endLine
}

/**
 * Line-grouped block pick for plain text surfaces (git diff, terminal log).
 * Hover paints the deepest block; click attaches it like file-preview pick.
 */
export function TextBlockPick({
  className,
  lines,
  blocks,
  sourcePath,
  badge,
  conversationId,
  renderLine
}: {
  className?: string
  lines: string[]
  blocks: PreviewBlock[]
  sourcePath: string
  badge: string
  conversationId?: string | null
  renderLine: (line: string, index: number) => ReactNode
}): React.JSX.Element {
  const t = useT()
  const activeId = useSessionStore((s) => s.activeId)
  const cid = conversationId ?? activeId
  // Do not `?? []` in the selector — a fresh array each snapshot loops zustand/React.
  const commentCards = useSessionStore((s) => (cid ? s.commentCards[cid] : undefined))
  const selectedIds = useMemo(
    () => selectedBlockIdsForPath(cid, sourcePath),
    [cid, sourcePath, commentCards]
  )
  const [hoverLine, setHoverLine] = useState<number | null>(null)

  const hoverBlock = useMemo(() => {
    if (hoverLine == null) return null
    const hit = blockAtLine(blocks, hoverLine)
    if (!hit || selectedIds.includes(hit.id)) return null
    return hit
  }, [blocks, hoverLine, selectedIds])

  const selectedBlocks = useMemo(
    () => selectedIds.map((id) => findBlockById(blocks, id)).filter((b): b is PreviewBlock => !!b),
    [blocks, selectedIds]
  )

  const pick = (line: number): void => {
    const hit = blockAtLine(blocks, line)
    if (hit) applyBlockPick({ conversationId: cid, sourcePath, badge, block: hit })
  }

  return (
    <pre
      className={`text-block-pick${className ? ` ${className}` : ''}`}
      onMouseLeave={() => setHoverLine(null)}
    >
      {lines.map((line, index) => {
        const n = index + 1
        const picked = selectedBlocks.some((b) => covers(b, n))
        const hovered = !picked && hoverBlock != null && covers(hoverBlock, n)
        return (
          <div
            key={n}
            className={`text-block-pick-line${picked ? ' is-picked' : ''}${
              hovered ? ' is-pick-hover' : ''
            }`}
            data-line={n}
            onMouseEnter={() => setHoverLine(n)}
            onMouseDown={(event) =>
              handleClickPickMouseDown(event, () => pick(n), { stopPropagation: false })
            }
            onContextMenu={(event) => {
              event.preventDefault()
              const hit = blockAtLine(blocks, n)
              if (!hit) return
              const parent = parentBlockOf(blocks, hit.id)
              void window.vav.window
                .popupMenu(
                  [
                    { id: 'copy', label: t('preview.copyBlock') },
                    ...(parent ? [{ id: 'parent', label: t('preview.selectParent') }] : [])
                  ],
                  { x: event.clientX, y: event.clientY }
                )
                .then((id) => {
                  if (id === 'copy') void window.vav.conversations.copyToClipboard(hit.text)
                  if (id === 'parent' && parent) {
                    applyBlockPick({
                      conversationId: cid,
                      sourcePath,
                      badge,
                      block: parent
                    })
                  }
                })
            }}
          >
            {renderLine(line, index)}
          </div>
        )
      })}
    </pre>
  )
}
