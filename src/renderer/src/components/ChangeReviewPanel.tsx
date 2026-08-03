import { useMemo, useState } from 'react'
import {
  ArrowLeft,
  Check,
  Folder,
  Pencil,
  Settings,
  X
} from 'lucide-react'
import type { ChangeEntry, ChangeType } from '@shared/changeSet'
import { useSessionStore } from '../state/sessionStore'
import { useT } from '../i18n/useT'
import { Button, EmptyState, Modal, Segmented } from './ui'
import wordmark from '../assets/wordmark.png'
import wordmarkDark from '../assets/wordmark-dark.png'

type Filter = 'all' | ChangeType

function relativeAgo(ts: number, t: ReturnType<typeof useT>): string {
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000))
  if (mins < 1) return t('review.justNow')
  return t('review.minutesAgo', { n: mins })
}

function diffStats(diffText: string): { plus: number; minus: number } {
  let plus = 0
  let minus = 0
  for (const line of diffText.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) plus++
    else if (line.startsWith('-') && !line.startsWith('---')) minus++
  }
  return { plus, minus }
}

function isLikelyBinaryPath(path: string): boolean {
  return /\.(pdf|docx?|xlsx?|pptx?|png|jpe?g|gif|webp|svg|ico|zip|dylib|so|dll|exe|bin|wasm|mp4|mov|wav|mp3)$/i.test(
    path
  )
}

function binaryKind(path: string): 'pdf' | 'office' | 'image' | 'other' {
  if (/\.pdf$/i.test(path)) return 'pdf'
  if (/\.(docx?|xlsx?|pptx?)$/i.test(path)) return 'office'
  if (/\.(png|jpe?g|gif|webp|svg|ico)$/i.test(path)) return 'image'
  return 'other'
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function BinaryCompare({ file }: { file: ChangeEntry }): React.JSX.Element {
  const t = useT()
  const kind = binaryKind(file.filePath)
  const beforeLen = file.originalContent?.length ?? 0
  const afterLen = file.newContent?.length ?? 0
  const kindLabel =
    kind === 'pdf' ? 'PDF' : kind === 'office' ? 'Office' : kind === 'image' ? 'Image' : 'Binary'

  return (
    <div className="review-binary">
      <div className="review-binary-meta">
        <div className="kv-row">
          <span className="kv-label">File</span>
          <span className="kv-value">{file.relativePath}</span>
        </div>
        <div className="kv-row">
          <span className="kv-label">Change</span>
          <span className="kv-value">
            {changeTypeLabel(file.changeType, t)} ({kindLabel})
          </span>
        </div>
        <div className="kv-row">
          <span className="kv-label">Before</span>
          <span className="kv-value">
            {file.originalContent == null ? '—' : formatBytes(beforeLen)}
          </span>
        </div>
        <div className="kv-row">
          <span className="kv-label">After</span>
          <span className="kv-value">{formatBytes(afterLen)}</span>
        </div>
      </div>
      <p className="muted tiny review-binary-hint">
        {kind === 'pdf'
          ? t('review.binaryPdfHint')
          : kind === 'office'
            ? t('review.binaryOfficeHint')
            : kind === 'image'
              ? t('review.binaryImageHint')
              : t('review.binaryOtherHint')}
      </p>
    </div>
  )
}

function DiffView({ text }: { text: string }): React.JSX.Element {
  const t = useT()
  const lines = text.split('\n')
  const truncated = lines.length > 200
  const shown = truncated ? lines.slice(0, 200) : lines
  const [expanded, setExpanded] = useState(false)
  const render = expanded ? lines : shown
  return (
    <pre className="review-diff">
      {render.map((line, i) => {
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
          title={t('tool.moreLines', { n: lines.length - 200 })}
          onClick={() => setExpanded(true)}
        >
          … {lines.length - 200} more lines
        </button>
      )}
    </pre>
  )
}

function FileInspector({ file }: { file: ChangeEntry }): React.JSX.Element {
  const looksBinary =
    isLikelyBinaryPath(file.filePath) ||
    (!file.diffText.startsWith('@@') && !file.diffText.startsWith('+') && file.diffText.length < 80)
  if (looksBinary) return <BinaryCompare file={file} />
  return <DiffView text={file.diffText} />
}

export function ChangeReviewPanel(): React.JSX.Element | null {
  const t = useT()
  const changeSet = useSessionStore((s) => s.changeSet)
  const changeReviewId = useSessionStore((s) => s.changeReviewId)
  const closeChangeReview = useSessionStore((s) => s.closeChangeReview)
  const acceptChangeFiles = useSessionStore((s) => s.acceptChangeFiles)
  const rejectChangeFiles = useSessionStore((s) => s.rejectChangeFiles)
  const acceptAllChanges = useSessionStore((s) => s.acceptAllChanges)
  const rejectAllChanges = useSessionStore((s) => s.rejectAllChanges)
  const undoChangeFile = useSessionStore((s) => s.undoChangeFile)
  const applyChangeEdit = useSessionStore((s) => s.applyChangeEdit)
  const showDialog = useSessionStore((s) => s.showDialog)
  const openSettings = useSessionStore((s) => s.openSettings)
  const conversations = useSessionStore((s) => s.conversations)

  const [filter, setFilter] = useState<Filter>('all')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [editPath, setEditPath] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')

  const files = changeSet?.files ?? []
  const filtered = useMemo(() => {
    if (filter === 'all') return files
    return files.filter((f) => f.changeType === filter)
  }, [files, filter])

  if (!changeReviewId || !changeSet) return null

  const pending = files.filter((f) => f.status === 'pending')
  const accepted = files.filter((f) => f.status === 'accepted' || f.status === 'edited').length
  const allResolved = pending.length === 0
  const workdir =
    conversations.find((c) => c.id === changeSet.conversationId)?.workingDirectory ?? null

  const selected =
    files.find((f) => f.filePath === selectedPath) ?? filtered[0] ?? null

  const toggleCheck = (path: string): void => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const riskLabel =
    changeSet.risk === 'high'
      ? t('review.riskHigh')
      : changeSet.risk === 'medium'
        ? t('review.riskMedium')
        : t('review.riskLow')

  return (
    <div className="change-review">
      <header className="titlebar review-nav">
        <Button
          icon={<ArrowLeft size={14} />}
          size="sm"
          title={t('review.back')}
          onClick={closeChangeReview}
        />
        <span className="about-logo review-logo" role="img" aria-label="vav">
          <img className="logo-light" src={wordmark} alt="" />
          <img className="logo-dark" src={wordmarkDark} alt="" />
        </span>
        <span className="review-nav-title">{t('review.title')}</span>
        <span className="spacer" />
        <Button
          icon={<Folder size={14} />}
          label={t('review.viewOnDisk')}
          size="sm"
          disabled={!workdir}
          onClick={() => workdir && void window.vav.conversations.revealInFinder(workdir)}
        />
        <Button
          icon={<Settings size={14} />}
          size="sm"
          title={t('app.settingsTitle', { shortcut: '' })}
          onClick={() => openSettings()}
        />
      </header>

      <div className="review-summary">
        <div>
          <div className="review-summary-row">
            <h2>
              {allResolved
                ? t('review.allReviewed', { n: files.length })
                : t('review.modifiedFiles', { n: files.length })}
            </h2>
            <span className={`review-tag risk-${changeSet.risk}`}>{riskLabel}</span>
            {accepted > 0 && (
              <span className="review-tag risk-low">{t('review.acceptedCount', { n: accepted })}</span>
            )}
          </div>
          <p className="muted">
            {t('review.turnMeta', {
              title: changeSet.turnTitle,
              model: changeSet.model || '—',
              ago: relativeAgo(changeSet.createdAt, t)
            })}
          </p>
          {changeSet.risk === 'high' && (
            <div className="review-high-alert">
              {t('review.highRiskAlert', { n: files.length })}
            </div>
          )}
        </div>
        <div className="review-bulk">
          <Button
            icon={<Check size={14} />}
            label={t('review.acceptAll')}
            variant="primary"
            disabled={allResolved || pending.length === 0}
            onClick={() => void acceptAllChanges()}
          />
          <Button
            icon={<X size={14} />}
            label={t('review.rejectAll')}
            variant="danger"
            disabled={allResolved}
            onClick={() =>
              showDialog({
                title: t('review.rejectAllTitle'),
                body: t('review.rejectAllBody', {
                  n: files.filter((f) => f.status !== 'rejected').length,
                  accepted
                }),
                confirmLabel: t('review.rejectAll'),
                destructive: true,
                onConfirm: () => void rejectAllChanges()
              })
            }
          />
        </div>
      </div>

      <div className="review-body">
        <div className="review-table-pane">
          <div className="review-table-toolbar">
            <span className="review-section-label">{t('review.changedFiles')}</span>
            <Segmented
              options={[
                { value: 'all' as const, label: t('review.filterAll') },
                { value: 'modified' as const, label: t('review.filterModified') },
                { value: 'added' as const, label: t('review.filterAdded') },
                { value: 'deleted' as const, label: t('review.filterDeleted') }
              ]}
              value={filter}
              onChange={setFilter}
            />
          </div>
          <div className="review-table">
            {filtered.map((file) => (
              <FileRow
                key={file.filePath}
                file={file}
                selected={selected?.filePath === file.filePath}
                checked={checked.has(file.filePath)}
                onSelect={() => setSelectedPath(file.filePath)}
                onToggle={() => toggleCheck(file.filePath)}
                onAccept={() => void acceptChangeFiles([file.filePath])}
                onReject={() => void rejectChangeFiles([file.filePath])}
                onUndo={() => void undoChangeFile(file.filePath)}
              />
            ))}
          </div>
          {checked.size > 0 && (
            <div className="review-selection-bar">
              <Button
                icon={<Check size={14} />}
                label={t('review.acceptSelected')}
                variant="primary"
                size="sm"
                disabled={[...checked].every(
                  (p) => files.find((f) => f.filePath === p)?.status !== 'pending'
                )}
                onClick={() => void acceptChangeFiles([...checked])}
              />
              <Button
                icon={<X size={14} />}
                label={t('review.rejectSelected')}
                size="sm"
                onClick={() => void rejectChangeFiles([...checked])}
              />
              <span className="spacer" />
              <Button
                icon={<Pencil size={14} />}
                label={t('review.editBeforeApply')}
                size="sm"
                onClick={() => {
                  const path =
                    [...checked].find(
                      (p) => files.find((f) => f.filePath === p)?.status === 'pending'
                    ) ?? selected?.filePath
                  const file = files.find((f) => f.filePath === path)
                  if (!file || file.status !== 'pending') return
                  setEditPath(file.filePath)
                  setEditDraft(file.newContent)
                }}
              />
            </div>
          )}
        </div>

        <div className="review-inspector">
          {selected ? (
            <>
              <div className="review-inspector-head">
                <div>
                  <div className="review-file-name">{selected.relativePath}</div>
                  <div className="muted">
                    {changeTypeLabel(selected.changeType, t)} ·{' '}
                    {(() => {
                      const { plus, minus } = diffStats(selected.diffText)
                      return t('review.lineStats', { plus, minus })
                    })()}
                  </div>
                </div>
                {selected.status === 'pending' ? (
                  <div className="review-bulk">
                    <Button
                      label={t('review.accept')}
                      variant="primary"
                      size="sm"
                      onClick={() => void acceptChangeFiles([selected.filePath])}
                    />
                    <Button
                      label={t('review.reject')}
                      size="sm"
                      onClick={() => void rejectChangeFiles([selected.filePath])}
                    />
                  </div>
                ) : (
                  <Button
                    label={t('review.undo')}
                    size="sm"
                    onClick={() => void undoChangeFile(selected.filePath)}
                  />
                )}
              </div>
              <FileInspector file={selected} />
            </>
          ) : (
            <EmptyState
              title={t('review.selectFile')}
              description={t('review.selectFileHint')}
            />
          )}
        </div>
      </div>

      {editPath && (
        <Modal
          title={t('review.editTitle', {
            name: files.find((f) => f.filePath === editPath)?.relativePath ?? ''
          })}
          onDismiss={() => setEditPath(null)}
          actions={
            <>
              <Button label={t('common.cancel')} onClick={() => setEditPath(null)} />
              <Button
                label={t('review.applyEdit')}
                variant="primary"
                onClick={() => {
                  void applyChangeEdit(editPath, editDraft).then(() => setEditPath(null))
                }}
              />
            </>
          }
        >
          <div className="review-edit-grid">
            <div>
              <div className="review-section-label">{t('review.agentDiff')}</div>
              <DiffView
                text={files.find((f) => f.filePath === editPath)?.diffText ?? ''}
              />
            </div>
            <div>
              <div className="review-section-label">{t('review.editFinal')}</div>
              <textarea
                className="review-edit-area"
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                rows={16}
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function changeTypeLabel(
  type: ChangeType,
  t: ReturnType<typeof useT>
): string {
  if (type === 'added') return t('review.typeAdded')
  if (type === 'deleted') return t('review.typeDeleted')
  return t('review.typeModified')
}

function FileRow({
  file,
  selected,
  checked,
  onSelect,
  onToggle,
  onAccept,
  onReject,
  onUndo
}: {
  file: ChangeEntry
  selected: boolean
  checked: boolean
  onSelect: () => void
  onToggle: () => void
  onAccept: () => void
  onReject: () => void
  onUndo: () => void
}): React.JSX.Element {
  const t = useT()
  const statusLabel =
    file.status === 'accepted'
      ? t('review.statusAccepted')
      : file.status === 'rejected'
        ? t('review.statusRejected')
        : file.status === 'edited'
          ? t('review.statusEdited')
          : t('review.statusPending')

  return (
    <div
      className={`review-row status-${file.status} ${selected ? 'selected' : ''}`}
      onClick={onSelect}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
      />
      <span className="review-row-path" title={file.filePath}>
        {file.relativePath}
      </span>
      <span className={`review-change-badge type-${file.changeType}`}>
        {file.changeType === 'added' ? '+' : file.changeType === 'deleted' ? '−' : 'M'}{' '}
        {changeTypeLabel(file.changeType, t)}
      </span>
      <span className="review-row-status">{statusLabel}</span>
      <span className="review-row-actions" onClick={(e) => e.stopPropagation()}>
        {file.status === 'pending' ? (
          <>
            <Button icon={<Check size={12} />} size="sm" title={t('review.accept')} onClick={onAccept} />
            <Button icon={<X size={12} />} size="sm" title={t('review.reject')} onClick={onReject} />
          </>
        ) : (
          <Button label={t('review.undo')} size="sm" onClick={onUndo} />
        )}
      </span>
    </div>
  )
}
