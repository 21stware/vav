import { useCallback, useEffect, useRef, useState } from 'react'
import { Bold, Eye, Heading1, Heading2, Italic, List, ListOrdered } from 'lucide-react'
import { useT } from '../../i18n/useT'
import { Button } from '../ui'
import { MarkdownView } from '../MarkdownView'

function wrapSelection(
  value: string,
  start: number,
  end: number,
  before: string,
  after = before
): { next: string; caret: number } {
  const selected = value.slice(start, end)
  const next = `${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`
  return { next, caret: start + before.length + selected.length + after.length }
}

export function KnowledgeNoteEditor({
  hostId
}: {
  hostId: string
}): React.JSX.Element {
  const t = useT()
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const [markdown, setMarkdown] = useState('')
  const [preview, setPreview] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const persist = useCallback(
    (value: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        void window.vav.knowledge.writeNote(hostId, value)
      }, 400)
    },
    [hostId]
  )

  useEffect(() => {
    let alive = true
    setLoaded(false)
    void window.vav.knowledge.readNote(hostId).then((note) => {
      if (!alive) return
      setMarkdown(note?.markdown ?? '')
      setLoaded(true)
    })
    const off = window.vav.knowledge.onChanged(() => {
      void window.vav.knowledge.readNote(hostId).then((note) => {
        if (!alive || !note) return
        setMarkdown((current) => (current === note.markdown ? current : note.markdown))
      })
    })
    return () => {
      alive = false
      off?.()
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [hostId])

  const applyWrap = (before: string, after?: string): void => {
    const el = areaRef.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const { next, caret } = wrapSelection(markdown, start, end, before, after)
    setMarkdown(next)
    persist(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(caret, caret)
    })
  }

  return (
    <div className="knowledge-note-editor" data-testid="knowledge-note-editor">
      <div className="knowledge-note-toolbar">
        <Button
          icon={<Heading1 size={13} />}
          variant="ghost"
          size="sm"
          title={t('knowledge.heading1')}
          onClick={() => applyWrap('# ', '')}
        />
        <Button
          icon={<Heading2 size={13} />}
          variant="ghost"
          size="sm"
          title={t('knowledge.heading2')}
          onClick={() => applyWrap('## ', '')}
        />
        <Button
          icon={<Bold size={13} />}
          variant="ghost"
          size="sm"
          title={t('knowledge.bold')}
          onClick={() => applyWrap('**')}
        />
        <Button
          icon={<Italic size={13} />}
          variant="ghost"
          size="sm"
          title={t('knowledge.italic')}
          onClick={() => applyWrap('_')}
        />
        <Button
          icon={<List size={13} />}
          variant="ghost"
          size="sm"
          title={t('knowledge.list')}
          onClick={() => applyWrap('- ', '')}
        />
        <Button
          icon={<ListOrdered size={13} />}
          variant="ghost"
          size="sm"
          title={t('knowledge.orderedList')}
          onClick={() => applyWrap('1. ', '')}
        />
        <span className="spacer" />
        <Button
          icon={<Eye size={13} />}
          variant="ghost"
          size="sm"
          pressed={preview}
          title={t('knowledge.preview')}
          testId="knowledge-note-preview"
          onClick={() => setPreview((value) => !value)}
        />
      </div>
      {preview ? (
        <div className="knowledge-note-preview">
          <MarkdownView source={markdown} />
        </div>
      ) : (
        <textarea
          ref={areaRef}
          className="knowledge-note-textarea"
          data-testid="knowledge-note-input"
          spellCheck={false}
          value={markdown}
          disabled={!loaded}
          placeholder={t('knowledge.notePlaceholder')}
          onChange={(event) => {
            const next = event.target.value
            setMarkdown(next)
            persist(next)
          }}
        />
      )}
    </div>
  )
}
