/**
 * Change review in the conversation stream — compact, icon-first actions.
 */
import { useEffect, useState } from 'react'
import {
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  FileDiff,
  Undo2,
  X,
  XCircle
} from 'lucide-react'
import type { ChangeEntry, ChangeSet } from '@shared/changeSet'
import { useSessionStore } from '../state/sessionStore'
import { useT } from '../i18n/useT'
import { basename } from '../lib/path'
import { BinaryChangeCard, looksLikeBinaryChange } from './BinaryChangeCard'

function diffStats(diffText: string): { plus: number; minus: number } {
  let plus = 0
  let minus = 0
  for (const line of diffText.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) plus++
    else if (line.startsWith('-') && !line.startsWith('---')) minus++
  }
  return { plus, minus }
}

function MiniDiff({ text }: { text: string }): React.JSX.Element {
  const lines = text.split('\n')
  const truncated = lines.length > 80
  const [expanded, setExpanded] = useState(false)
  const shown = expanded || !truncated ? lines : lines.slice(0, 80)
  return (
    <pre className="inline-review-diff">
      {shown.map((line, i) => {
        let cls = 'ctx'
        if (line.startsWith('+') && !line.startsWith('+++')) cls = 'add'
        else if (line.startsWith('-') && !line.startsWith('---')) cls = 'del'
        else if (line.startsWith('@@')) cls = 'hunk'
        return (
          <div key={i} className={`diff-line ${cls}`}>
            {line || ' '}
          </div>
        )
      })}
      {truncated && !expanded && (
        <button
          type="button"
          className="diff-more"
          title={t('git.moreLines')}
          onClick={() => setExpanded(true)}
        >
          … {lines.length - 80} more lines
        </button>
      )}
    </pre>
  )
}

function IconBtn({
  kind,
  title,
  onClick,
  children,
  testId
}: {
  kind: 'accept' | 'reject' | 'neutral'
  title: string
  onClick: () => void
  children: React.ReactNode
  testId?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`inline-review-icon-btn kind-${kind}`}
      title={title}
      aria-label={title}
      data-testid={testId}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      {children}
    </button>
  )
}

export function InlineChangeReview({
  changeSetId
}: {
  changeSetId: string
}): React.JSX.Element | null {
  const t = useT()
  const cached = useSessionStore((s) => s.changeSetsById[changeSetId] ?? null)
  const openChangeReview = useSessionStore((s) => s.openChangeReview)
  const acceptChangeFilesFor = useSessionStore((s) => s.acceptChangeFilesFor)
  const rejectChangeFilesFor = useSessionStore((s) => s.rejectChangeFilesFor)
  const acceptAllChangesFor = useSessionStore((s) => s.acceptAllChangesFor)
  const rejectAllChangesFor = useSessionStore((s) => s.rejectAllChangesFor)
  const undoChangeFileFor = useSessionStore((s) => s.undoChangeFileFor)
  const showDialog = useSessionStore((s) => s.showDialog)

  const [openPath, setOpenPath] = useState<string | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    if (cached) {
      setLoadFailed(false)
      return
    }
    let cancelled = false
    setLoadFailed(false)
    void openChangeReview(changeSetId).then(() => {
      if (cancelled) return
      const now = useSessionStore.getState().changeSetsById[changeSetId]
      if (!now) setLoadFailed(true)
    })
    return () => {
      cancelled = true
    }
  }, [changeSetId, cached, openChangeReview])

  const set: ChangeSet | null = cached
  if (!set) {
    // Failed / missing sets: render nothing (next-turn cleanup also strips these).
    if (loadFailed) return null
    return (
      <div className="inline-review is-loading">
        <FileDiff size={14} />
        <span>{t('review.loading')}</span>
      </div>
    )
  }

  const pending = set.files.filter((f) => f.status === 'pending')
  const allResolved = pending.length === 0
  const n = set.files.length
  const title = allResolved
    ? t('review.allReviewedShort', { n })
    : t('review.modifiedFilesShort', { n })

  return (
    <div
      className={`inline-review${allResolved ? ' is-resolved' : ''}`}
      data-testid="inline-review"
    >
      <div className="inline-review-head">
        <FileDiff size={14} className="inline-review-icon" aria-hidden />
        <span className="inline-review-title" title={title}>
          {title}
        </span>
        {!allResolved && (
          <div className="inline-review-actions">
            <IconBtn
              kind="accept"
              title={t('review.acceptAll')}
              testId="inline-review-accept-all"
              onClick={() => void acceptAllChangesFor(set.id)}
            >
              <CheckCheck size={14} strokeWidth={2.25} />
            </IconBtn>
            <IconBtn
              kind="reject"
              title={t('review.rejectAll')}
              onClick={() =>
                showDialog({
                  title: t('review.rejectAllTitle'),
                  body: t('review.rejectAllBody', {
                    n: set.files.filter((f) => f.status !== 'rejected').length,
                    accepted: set.files.filter(
                      (f) => f.status === 'accepted' || f.status === 'edited'
                    ).length
                  }),
                  confirmLabel: t('review.rejectAll'),
                  destructive: true,
                  onConfirm: () => void rejectAllChangesFor(set.id)
                })
              }
            >
              <XCircle size={14} strokeWidth={2.25} />
            </IconBtn>
          </div>
        )}
      </div>

      <ul className="inline-review-files">
        {set.files.map((file) => (
          <FileRow
            key={file.filePath}
            file={file}
            expanded={openPath === file.filePath}
            onToggle={() =>
              setOpenPath((p) => (p === file.filePath ? null : file.filePath))
            }
            onAccept={() => void acceptChangeFilesFor(set.id, [file.filePath])}
            onReject={() => void rejectChangeFilesFor(set.id, [file.filePath])}
            onUndo={() => void undoChangeFileFor(set.id, file.filePath)}
          />
        ))}
      </ul>
    </div>
  )
}

function FileRow({
  file,
  expanded,
  onToggle,
  onAccept,
  onReject,
  onUndo
}: {
  file: ChangeEntry
  expanded: boolean
  onToggle: () => void
  onAccept: () => void
  onReject: () => void
  onUndo: () => void
}): React.JSX.Element {
  const t = useT()
  const { plus, minus } = diffStats(file.diffText)
  const binary = looksLikeBinaryChange(file)
  const name = file.relativePath || basename(file.filePath)
  const typeLabel =
    file.changeType === 'added'
      ? t('review.typeAdded')
      : file.changeType === 'deleted'
        ? t('review.typeDeleted')
        : t('review.typeModified')
  const stats =
    plus || minus
      ? `+${plus}/−${minus}`
      : binary
        ? file.diffText && file.diffText.length < 48
          ? file.diffText
          : 'raw'
        : file.changeType === 'added'
          ? 'new'
          : ''
  const meta = [typeLabel, stats].filter(Boolean).join(' · ')
  const statusLabel =
    file.status === 'pending'
      ? t('review.statusPending')
      : file.status === 'rejected'
        ? t('review.statusRejected')
        : file.status === 'edited'
          ? t('review.statusEdited')
          : t('review.statusAccepted')

  return (
    <li
      className={`inline-review-file status-${file.status}`}
      data-testid="inline-review-file"
      data-name={name}
      data-open={expanded || undefined}
    >
      <div className="inline-review-file-main">
        <button
          type="button"
          className="inline-review-file-row"
          title={expanded ? t('common.collapse') : t('common.expand')}
          aria-expanded={expanded}
          onClick={onToggle}
        >
          <span className="inline-review-chevron" aria-hidden>
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
          <span className="inline-review-file-name" title={file.filePath}>
            {name}
          </span>
          <span className="inline-review-file-meta" title={meta}>
            {meta}
          </span>
          <span
            className={`inline-review-dot status-${file.status}`}
            title={statusLabel}
            aria-label={statusLabel}
          />
        </button>
        <div className="inline-review-file-actions">
          {file.status === 'pending' ? (
            <>
              <IconBtn kind="accept" title={t('review.accept')} onClick={onAccept}>
                <Check size={14} strokeWidth={2.25} />
              </IconBtn>
              <IconBtn kind="reject" title={t('review.reject')} onClick={onReject}>
                <X size={14} strokeWidth={2.25} />
              </IconBtn>
            </>
          ) : (
            <IconBtn kind="neutral" title={t('review.undo')} onClick={onUndo}>
              <Undo2 size={13} strokeWidth={2.25} />
            </IconBtn>
          )}
        </div>
      </div>
      {/* Stay mounted so grid-template-rows can retarget open/close mid-flight. */}
      <div className="inline-review-file-detail">
        <div className="inline-review-file-detail-inner">
          <div className="inline-review-file-body">
            {binary ? (
              <BinaryChangeCard file={file} compact />
            ) : (
              <MiniDiff text={file.diffText} />
            )}
          </div>
        </div>
      </div>
    </li>
  )
}
