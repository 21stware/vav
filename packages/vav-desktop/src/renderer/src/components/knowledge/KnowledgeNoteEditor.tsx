import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import {
  createEditor,
  type CodeHighlighter,
  type EditorPhase,
  type HandyEditor
} from '@21stware/handymd'
import { noteMarkdownWithTitle } from '@shared/knowledge'
import { Plugin, TextSelection } from 'prosemirror-state'
import { applyFileDraftContent } from '../../lib/fileViewerHelpers'
import {
  decideKnowledgeNotePaint,
  type KnowledgeNotePaintSource
} from '../../lib/knowledgeNotePaint'
import '@21stware/handymd/style.css'
import { useT } from '../../i18n/useT'
import { isDraftNoteTitle } from '../../lib/draftEditorTitle'
import { renderMermaidSvgMarkup } from '../../lib/mermaidRender'
import { countWritingUnits } from '../../lib/writingStats'
import { Button } from '../ui'
import { countFact, ObjectFacts, timeFact } from '../ObjectFacts'

/** Avoid pulling shiki; fences still get HandyMD's mono + panel chrome. */
const highlightPlain: CodeHighlighter = (code) =>
  code.split('\n').map((text) => [{ text }])

function renderNoteDiagram(code: string): Promise<string> {
  return renderMermaidSvgMarkup(code).then((result) => result.svg)
}

/**
 * Paint a disk or agent write into the open note. A viewer who is not typing
 * should see the body change as a write streams. Own autosave echoes must not
 * look like a remote conflict — local typing still goes through conflict
 * resolution when the incoming body is actually new.
 */
function paintAgentNote(
  editor: HandyEditor,
  markdown: string,
  lastSaved: { current: string },
  userEdited: { current: boolean },
  source: KnowledgeNotePaintSource
): void {
  if (editor.phase === 'destroyed' || editor.phase === 'error' || editor.phase === 'loading') return
  if (!editor.view) return
  const current = editor.getMarkdown()
  const action = decideKnowledgeNotePaint({
    incoming: markdown,
    current,
    lastSaved: lastSaved.current,
    localDirty: userEdited.current && current !== lastSaved.current,
    source,
    phase: editor.phase
  })
  if (action === 'ignore') return
  if (action === 'ack') {
    lastSaved.current = markdown
    userEdited.current = false
    editor.autosave?.markClean()
    return
  }
  if (action === 'conflict') {
    editor.notifyRemote(markdown)
    return
  }
  if (editor.phase === 'conflicted') editor.resolveConflict('remote')
  if (editor.phase !== 'ready') return
  if (markdown === editor.getMarkdown()) {
    lastSaved.current = markdown
    userEdited.current = false
    editor.autosave?.markClean()
    return
  }
  editor.setMarkdown(markdown, { addToHistory: false })
  editor.autosave?.markClean()
  lastSaved.current = editor.getMarkdown()
  userEdited.current = false
}

export type KnowledgeNoteEditorHandle = {
  applyTitle: (title: string) => void
  focusBody: () => void
}

/**
 * The page title field edits the leading heading. Keep the caret out of that
 * hidden line, and ArrowUp from the top of the body returns to the field.
 */
function noteTitlePlugin(opts: {
  active: () => boolean
  onTitle: () => void
}): Plugin {
  return new Plugin({
    appendTransaction(trs, _old, state) {
      if (!opts.active()) return null
      if (trs.some((tr) => tr.getMeta('note-title-skip'))) return null
      if (!trs.some((tr) => tr.selectionSet || tr.docChanged)) return null
      const first = state.doc.firstChild
      if (!first || !/^#\s+\S/.test(first.textContent) || state.doc.childCount < 2) return null
      if (state.selection.$from.index(0) !== 0) return null
      const next = TextSelection.near(state.doc.resolve(first.nodeSize), 1)
      if (next.eq(state.selection)) return null
      return state.tr.setSelection(next).setMeta('note-title-skip', true)
    },
    props: {
      handleKeyDown(view, event) {
        if (!opts.active() || event.key !== 'ArrowUp') return false
        const first = view.state.doc.firstChild
        if (!first || !/^#\s+\S/.test(first.textContent)) return false
        const head = view.state.selection.$head
        if (head.index(0) > 1) return false
        if (head.index(0) === 1 && head.parentOffset > 0) return false
        opts.onTitle()
        return true
      }
    }
  })
}

/** Move the caret into the note body, past the stored title heading. */
function focusNoteBody(editor: HandyEditor | null, skipTitleHeading: boolean): void {
  const view = editor?.view
  if (!editor || !view) return
  if (skipTitleHeading) {
    const first = view.state.doc.firstChild
    if (first && /^#\s+\S/.test(first.textContent) && view.state.doc.childCount > 1) {
      const selection = TextSelection.near(view.state.doc.resolve(1 + first.nodeSize), 1)
      view.dispatch(view.state.tr.setSelection(selection))
    }
  }
  editor.focus()
}

export const NoteTitleField = forwardRef<
  HTMLInputElement,
  {
    title: string
    variant: 'reading' | 'chrome'
    onCommit: (title: string) => void
    onMoveToBody?: () => void
  }
>(function NoteTitleField({ title, variant, onCommit, onMoveToBody }, ref): React.JSX.Element {
  const t = useT()
  const [draft, setDraft] = useState(title)
  const dirty = useRef(false)
  const untitled = t('knowledge.untitled')

  useEffect(() => {
    if (dirty.current) return
    setDraft(title)
  }, [title])

  const commit = (): void => {
    if (!dirty.current) return
    dirty.current = false
    const next = draft.trim()
    if (!next || next === title.trim()) {
      setDraft(title)
      return
    }
    onCommit(next)
  }

  return (
    <input
      ref={ref}
      className={`knowledge-note-title${variant === 'chrome' ? ' is-chrome' : ''}${
        isDraftNoteTitle(draft, untitled) ? ' is-untitled' : ''
      }`}
      data-testid="knowledge-note-title"
      value={draft}
      placeholder={t('knowledge.noteTitle')}
      aria-label={t('knowledge.noteTitle')}
      autoComplete="off"
      spellCheck={false}
      onChange={(event) => {
        dirty.current = true
        setDraft(event.currentTarget.value)
      }}
      onFocus={(event) => {
        if (isDraftNoteTitle(event.currentTarget.value, untitled)) event.currentTarget.select()
      }}
      onBlur={() => commit()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          commit()
          onMoveToBody?.()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          dirty.current = false
          setDraft(title)
          event.currentTarget.blur()
        } else if (event.key === 'ArrowDown') {
          event.preventDefault()
          commit()
          onMoveToBody?.()
        }
      }}
    />
  )
})

const NoteEditor = forwardRef<
  KnowledgeNoteEditorHandle,
  {
    hostId: string
    title: string
    showTitle: boolean
    createdAt: number
    updatedAt: number
  }
>(function NoteEditor({ hostId, title, showTitle, createdAt, updatedAt }, ref): React.JSX.Element {
  const t = useT()
  const mountRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HandyEditor | null>(null)
  const titleFieldRef = useRef<HTMLInputElement>(null)
  const lastSavedRef = useRef('')
  const userEditedRef = useRef(false)
  const showTitleRef = useRef(showTitle)
  showTitleRef.current = showTitle
  const [phase, setPhase] = useState<EditorPhase>('loading')
  const [words, setWords] = useState<number | null>(null)
  const [savedAt, setSavedAt] = useState(updatedAt)

  useEffect(() => {
    setSavedAt(updatedAt)
  }, [updatedAt])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount || !window.vav?.knowledge) return

    const editor = createEditor({
      mount,
      load: async () => {
        const note = await window.vav.knowledge.readNote(hostId)
        const markdown = note?.markdown ?? ''
        lastSavedRef.current = markdown
        setWords(countWritingUnits(markdown))
        if (note?.updatedAt) setSavedAt(note.updatedAt)
        return markdown
      },
      save: async (markdown) => {
        const previous = lastSavedRef.current
        lastSavedRef.current = markdown
        try {
          const note = await window.vav.knowledge.writeNote(hostId, markdown)
          if (!note) throw new Error('knowledge-write-failed')
          setSavedAt(note.updatedAt)
        } catch (err) {
          lastSavedRef.current = previous
          throw err
        }
      },
      autosave: { debounceMs: 400 },
      highlight: highlightPlain,
      diagram: renderNoteDiagram,
      plugins: [
        noteTitlePlugin({
          active: () => showTitleRef.current,
          onTitle: () => {
            const field = titleFieldRef.current
            if (!field) return
            field.focus()
            field.scrollIntoView({ block: 'nearest' })
            if (!field.classList.contains('is-untitled')) {
              const end = field.value.length
              field.setSelectionRange(end, end)
            }
          }
        })
      ],
      onChange: (markdown) => setWords(countWritingUnits(markdown)),
      onPhaseChange: setPhase
    })
    editorRef.current = editor
    userEditedRef.current = false

    const userEdited = userEditedRef
    const painting = { current: false }
    const pending = { current: null as { markdown: string; source: KnowledgeNotePaintSource } | null }
    const onBeforeInput = (): void => {
      if (!painting.current) userEdited.current = true
    }
    mount.addEventListener('beforeinput', onBeforeInput)

    const paint = (markdown: string, source: KnowledgeNotePaintSource): void => {
      if (editor.phase === 'loading' || !editor.view) {
        pending.current = { markdown, source }
        return
      }
      pending.current = null
      painting.current = true
      try {
        paintAgentNote(editor, markdown, lastSavedRef, userEdited, source)
      } finally {
        painting.current = false
      }
      if (editor.view) setWords(countWritingUnits(editor.getMarkdown()))
    }

    const offPhase = editor.on('phase', (phase) => {
      if (phase === 'ready' && pending.current != null) {
        const next = pending.current
        pending.current = null
        paintAgentNote(editor, next.markdown, lastSavedRef, userEdited, next.source)
        setWords(countWritingUnits(next.markdown))
      }
    })

    const off = window.vav.knowledge.onChanged(() => {
      void window.vav.knowledge.readNote(hostId).then((note) => {
        if (!note || editor.phase === 'destroyed') return
        paint(note.markdown, 'disk')
        setSavedAt(note.updatedAt)
      })
    })

    const offAgent = window.vav.agent?.onEvent((event) => {
      if (event.type !== 'knowledge-draft' || event.hostId !== hostId) return
      const next = applyFileDraftContent(editor.getMarkdown() || '', event)
      if (next == null) return
      paint(next, 'agent')
    })

    return () => {
      mount.removeEventListener('beforeinput', onBeforeInput)
      offPhase()
      off?.()
      offAgent?.()
      editorRef.current = null
      void editor.destroy()
    }
  }, [hostId])

  const applyTitle = useCallback((next: string): void => {
    const trimmed = next.trim()
    if (!trimmed) return
    const editor = editorRef.current
    if (editor && editor.phase === 'ready' && editor.view) {
      const markdown = noteMarkdownWithTitle(editor.getMarkdown(), trimmed)
      if (markdown === editor.getMarkdown()) return
      userEditedRef.current = true
      editor.setMarkdown(markdown)
      void editor.flush()
      return
    }
    void window.vav?.knowledge?.rename(hostId, trimmed)
  }, [hostId])

  useImperativeHandle(
    ref,
    () => ({
      applyTitle,
      focusBody: () => focusNoteBody(editorRef.current, showTitleRef.current)
    }),
    [applyTitle]
  )

  return (
    <div
      className={`knowledge-note-editor${showTitle ? ' has-masthead' : ''}`}
      data-testid="knowledge-note-editor"
      data-phase={phase}
    >
      {phase === 'error' ? (
        <div className="knowledge-note-banner" role="alert">
          <span>{t('knowledge.noteLoadFailed')}</span>
          <span className="spacer" />
          <Button
            size="sm"
            label={t('knowledge.noteRetry')}
            testId="knowledge-note-retry"
            onClick={() => editorRef.current?.retry()}
          />
        </div>
      ) : null}
      {phase === 'conflicted' ? (
        <div className="knowledge-note-banner" role="alert">
          <span>{t('knowledge.noteConflict')}</span>
          <span className="spacer" />
          <Button
            size="sm"
            label={t('knowledge.noteKeepLocal')}
            testId="knowledge-note-keep-local"
            onClick={() => editorRef.current?.resolveConflict('local')}
          />
          <Button
            size="sm"
            label={t('knowledge.noteUseRemote')}
            testId="knowledge-note-use-remote"
            onClick={() => {
              const remote = editorRef.current?.remoteConflict
              if (remote != null) lastSavedRef.current = remote
              editorRef.current?.resolveConflict('remote')
            }}
          />
        </div>
      ) : null}
      <div className="knowledge-note-scroll">
        {showTitle ? (
          <div className="object-masthead is-reading">
            <NoteTitleField
              ref={titleFieldRef}
              title={title}
              variant="reading"
              onCommit={applyTitle}
              onMoveToBody={() => focusNoteBody(editorRef.current, true)}
            />
          </div>
        ) : null}
        <div
          ref={mountRef}
          className="knowledge-note-handymd"
          data-testid="knowledge-note-input"
        />
      </div>
      <ObjectFacts
        items={[
          timeFact('created', t('object.fact.created'), createdAt),
          timeFact('updated', t('object.fact.updated'), savedAt),
          countFact('words', t('object.fact.words'), words)
        ]}
      />
    </div>
  )
})

export const KnowledgeNoteEditor = forwardRef<
  KnowledgeNoteEditorHandle,
  {
    hostId: string
    title: string
    showTitle?: boolean
    createdAt: number
    updatedAt: number
  }
>(function KnowledgeNoteEditor(
  { hostId, title, showTitle = false, createdAt, updatedAt },
  ref
): React.JSX.Element {
  return (
    <NoteEditor
      key={hostId}
      ref={ref}
      hostId={hostId}
      title={title}
      showTitle={showTitle}
      createdAt={createdAt}
      updatedAt={updatedAt}
    />
  )
})
