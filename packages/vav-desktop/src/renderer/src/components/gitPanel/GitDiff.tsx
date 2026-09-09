import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { GitChangeEntry } from '@shared/git'
import { useSessionStore } from '../../state/sessionStore'
import { useT } from '../../i18n/useT'
import { highlightCode, languageFromPath } from '../../lib/highlightCode'
import { selectedBlockIdsForPath } from '../../lib/applyBlockPick'
import { parseDiffBlocks } from '../../lib/previewBlocks'
import { TextBlockPick } from '../TextBlockPick'
import { SelectionChrome } from '../SelectionChrome'
import { onHljsReady } from '../../lib/hljsLazy'
import { dirname } from '../../lib/path'
import { fileManagerLabel } from '../../lib/platform'
import { FileManagerIcon } from '../FileManagerIcon'
import { Button } from '../ui'

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|ico|bmp|avif)$/i

function mimeForImagePath(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  if (lower.endsWith('.ico')) return 'image/x-icon'
  if (lower.endsWith('.bmp')) return 'image/bmp'
  if (lower.endsWith('.avif')) return 'image/avif'
  return 'application/octet-stream'
}

function isImagePath(path: string): boolean {
  return IMAGE_EXT.test(path)
}

function looksBinaryDiff(text: string): boolean {
  return /Binary files .* differ/i.test(text) || /GIT binary patch/i.test(text)
}

function isDiffMetaLine(line: string): boolean {
  return (
    line.startsWith('+++') ||
    line.startsWith('---') ||
    line.startsWith('diff ') ||
    line.startsWith('index ') ||
    line.startsWith('commit ') ||
    line.startsWith('Author:') ||
    line.startsWith('Date:') ||
    line.startsWith('Merge:') ||
    line.startsWith('stash@{')
  )
}

export function DiffLines({ text, filePath }: { text: string; filePath: string }): React.JSX.Element {
  const t = useT()
  const lang = languageFromPath(filePath)
  const [, setHljsTick] = useState(0)
  useEffect(() => onHljsReady(() => setHljsTick((n) => n + 1)), [])

  const lines = text.split('\n')
  const truncated = lines.length > 800
  const [expanded, setExpanded] = useState(false)
  const render = expanded || !truncated ? lines : lines.slice(0, 800)
  const visibleText = expanded || !truncated ? text : render.join('\n')
  const blocks = useMemo(() => parseDiffBlocks(visibleText, filePath), [visibleText, filePath])

  return (
    <>
      <TextBlockPick
        className="git-diff"
        lines={render}
        blocks={blocks}
        sourcePath={`git-diff:${filePath}`}
        badge="DIFF"
        renderLine={(line) => {
          let cls = 'ctx'
          let prefix = ''
          let code = line
          if (isDiffMetaLine(line)) {
            cls = 'meta'
          } else if (line.startsWith('@@')) {
            cls = 'hunk'
          } else if (line.startsWith('+')) {
            cls = 'add'
            prefix = '+'
            code = line.slice(1)
          } else if (line.startsWith('-')) {
            cls = 'del'
            prefix = '-'
            code = line.slice(1)
          } else if (line.startsWith(' ')) {
            prefix = ' '
            code = line.slice(1)
          }

          const highlighted =
            cls === 'add' || cls === 'del' || cls === 'ctx' ? highlightCode(code, lang) : null

          return (
            <div className={`diff-line ${cls}`}>
              {highlighted != null ? (
                <>
                  <span className="diff-prefix" aria-hidden>
                    {prefix || ' '}
                  </span>
                  <span
                    className="diff-code"
                    dangerouslySetInnerHTML={{ __html: highlighted || ' ' }}
                  />
                </>
              ) : (
                <span className="diff-code">{line || ' '}</span>
              )}
            </div>
          )
        }}
      />
      {truncated && !expanded && (
        <button
          type="button"
          className="diff-more"
          title={t('git.moreLines')}
          onClick={() => setExpanded(true)}
        >
          … {lines.length - 800} {t('git.moreLines')}
        </button>
      )}
    </>
  )
}

function ImageDiffView({
  cwd,
  entry
}: {
  cwd: string
  entry: GitChangeEntry
}): React.JSX.Element {
  const t = useT()
  const [before, setBefore] = useState<string | null | undefined>(undefined)
  const [after, setAfter] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    setBefore(undefined)
    setAfter(undefined)
    const mime = mimeForImagePath(entry.path)

    void (async () => {
      if (entry.status !== 'added' && entry.status !== 'untracked') {
        if (window.vav?.git?.showBase64) {
          try {
            const res = await window.vav.git.showBase64(
              cwd,
              entry.path,
              'HEAD',
              useSessionStore.getState().activeId
            )
            if (cancelled) return
            if (res.ok && res.data.base64) {
              setBefore(`data:${mime};base64,${res.data.base64}`)
            } else {
              setBefore(null)
            }
          } catch {
            if (!cancelled) setBefore(null)
          }
        } else if (!cancelled) {
          setBefore(null)
        }
      } else if (!cancelled) {
        setBefore(null)
      }

      if (entry.status !== 'deleted') {
        try {
          const bin = await window.vav.files.readBinary(
            entry.absolutePath,
            useSessionStore.getState().activeId
          )
          if (cancelled) return
          if (bin.ok) {
            setAfter(`data:${bin.mime || mime};base64,${bin.base64}`)
          } else {
            setAfter(null)
          }
        } catch {
          if (!cancelled) setAfter(null)
        }
      } else if (!cancelled) {
        setAfter(null)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [cwd, entry])

  return (
    <div className="git-image-diff">
      <div className="git-image-col">
        <div className="git-image-label">{t('git.imageBefore')}</div>
        {before === undefined ? (
          <div className="token-usage-muted">{t('common.loading')}</div>
        ) : before ? (
          <img className="git-image-preview" src={before} alt={t('git.imageBefore')} />
        ) : (
          <div className="git-image-missing">{t('git.imageMissing')}</div>
        )}
      </div>
      <div className="git-image-col">
        <div className="git-image-label">{t('git.imageAfter')}</div>
        {after === undefined ? (
          <div className="token-usage-muted">{t('common.loading')}</div>
        ) : after ? (
          <img className="git-image-preview" src={after} alt={t('git.imageAfter')} />
        ) : (
          <div className="git-image-missing">{t('git.imageMissing')}</div>
        )}
      </div>
    </div>
  )
}

export function GitDiffContent({
  cwd,
  entry,
  diff,
  diffError
}: {
  cwd: string
  entry: GitChangeEntry
  diff: string | null
  diffError: string | null
}): React.JSX.Element {
  const t = useT()
  const hostRef = useRef<HTMLDivElement>(null)
  const activeId = useSessionStore((s) => s.activeId)
  const commentCards = useSessionStore((s) => (activeId ? s.commentCards[activeId] : undefined))
  const showSelectionAgentMark = useSessionStore(
    (s) => s.settings.previewSelectionAgentMark !== false
  )
  const selectedIds = useMemo(
    () => selectedBlockIdsForPath(activeId, `git-diff:${entry.path}`),
    [activeId, entry.path, commentCards]
  )
  const showImage =
    isImagePath(entry.path) &&
    (diff == null || looksBinaryDiff(diff) || diff.trim() === '' || diff.includes('(no textual'))

  return (
    <div className="git-diff-stage has-selection-hud" ref={hostRef}>
      <SelectionChrome
        hostRef={hostRef}
        selectedIds={selectedIds}
        enabled
        fab={
          showSelectionAgentMark && selectedIds.length > 0
            ? {
                title: t('preview.agentPanel'),
                onClick: () => useSessionStore.getState().focusComposer()
              }
            : null
        }
      />
      <div className="git-diff-scroll">
        {diffError ? (
          <div className="git-diff-error">{diffError}</div>
        ) : showImage ? (
          <ImageDiffView cwd={cwd} entry={entry} />
        ) : diff == null ? (
          <div className="token-usage-muted">{t('common.loading')}</div>
        ) : looksBinaryDiff(diff) ? (
          <div className="git-binary-note">{t('git.binaryDiff')}</div>
        ) : (
          <DiffLines text={diff} filePath={entry.path} />
        )}
      </div>
    </div>
  )
}

/** Session-right preview: git diff for the selected changed file. */
export function GitDiffPreview({
  cwd,
  entry,
  onClose
}: {
  cwd: string
  entry: GitChangeEntry
  onClose: () => void
}): React.JSX.Element {
  const t = useT()
  const [diff, setDiff] = useState<string | null>(null)
  const [diffError, setDiffError] = useState<string | null>(null)

  useEffect(() => {
    if (!window.vav?.git?.diff) {
      setDiff(null)
      setDiffError(t('git.apiMissing'))
      return
    }
    let cancelled = false
    setDiff(null)
    setDiffError(null)
    void (async () => {
      try {
        const result = await window.vav.git.diff(cwd, entry.path, {
          conversationId: useSessionStore.getState().activeId
        })
        if (cancelled) return
        if (!result.ok) {
          setDiff(null)
          setDiffError(result.error)
          return
        }
        setDiffError(null)
        setDiff(result.data)
      } catch (err) {
        if (cancelled) return
        setDiff(null)
        setDiffError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [cwd, entry.path, t])

  const reveal = (): void => {
    const target = entry.status === 'deleted' ? dirname(entry.absolutePath) : entry.absolutePath
    void window.vav.conversations.revealInFinder(target)
  }

  return (
    <div className="git-preview">
      <header className="workspace-preview-chrome">
        <span className="git-diff-filename" title={entry.path}>
          {entry.path}
        </span>
        <Button
          icon={<FileManagerIcon size={14} />}
          title={t('git.revealInFm', { fileManager: fileManagerLabel() })}
          onClick={reveal}
        />
        <Button icon={<X size={14} />} title={t('common.close')} onClick={onClose} />
      </header>
      <GitDiffContent cwd={cwd} entry={entry} diff={diff} diffError={diffError} />
    </div>
  )
}

export function GitPatchView({
  text,
  error,
  spec
}: {
  text: string | null
  error: string | null
  spec: string
}): React.JSX.Element {
  const t = useT()
  return (
    <div className="git-diff-stage">
      <div className="git-diff-scroll">
        {error ? (
          <div className="git-diff-error">{error}</div>
        ) : text == null ? (
          <div className="token-usage-muted">{t('common.loading')}</div>
        ) : looksBinaryDiff(text) ? (
          <div className="git-binary-note">{t('git.binaryDiff')}</div>
        ) : (
          <DiffLines text={text} filePath={`${spec}.diff`} />
        )}
      </div>
    </div>
  )
}

/** Session-right preview: commit / branch / stash patch. */
export function GitPatchPreview({
  cwd,
  spec,
  title,
  onClose
}: {
  cwd: string
  spec: string
  title: string
  onClose: () => void
}): React.JSX.Element {
  const t = useT()
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!window.vav?.git?.patch) {
      setText(null)
      setError(t('git.apiMissing'))
      return
    }
    let cancelled = false
    setText(null)
    setError(null)
    void (async () => {
      try {
        const result = await window.vav.git.patch(
          cwd,
          spec,
          useSessionStore.getState().activeId
        )
        if (cancelled) return
        if (!result.ok) {
          setText(null)
          setError(result.error)
          return
        }
        setError(null)
        setText(result.data)
      } catch (err) {
        if (cancelled) return
        setText(null)
        setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [cwd, spec, t])

  return (
    <div className="git-preview">
      <header className="workspace-preview-chrome">
        <span className="git-diff-filename" title={title}>
          {title}
        </span>
        <Button icon={<X size={14} />} title={t('common.close')} onClick={onClose} />
      </header>
      <GitPatchView text={text} error={error} spec={spec} />
    </div>
  )
}
