/**
 * GitHub-style “binary / raw file” body for Change Review — always shown for
 * office/PDF/images even when there is no line diff.
 */
import type { ChangeEntry } from '@shared/changeSet'
import { isBinaryChange } from '@shared/changeSet'
import { useT } from '../i18n/useT'
import { basename } from '../lib/path'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function byteLength(file: ChangeEntry, which: 'before' | 'after'): number | null {
  const raw = which === 'before' ? file.originalContent : file.newContent
  if (raw == null || raw === '') return which === 'before' && file.changeType === 'added' ? null : 0
  if (file.contentEncoding === 'base64') {
    const pad = raw.endsWith('==') ? 2 : raw.endsWith('=') ? 1 : 0
    return Math.max(0, Math.floor((raw.length * 3) / 4) - pad)
  }
  // utf8 string length is a coarse stand-in when we only have text
  return raw.length
}

function kindLabel(path: string): string {
  const base = basename(path)
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1).toUpperCase() : 'RAW'
  if (/^DOCX?$/i.test(ext)) return 'DOCX'
  if (/^XLSX?$/i.test(ext)) return 'XLSX'
  if (/^PPTX?$/i.test(ext)) return 'PPTX'
  return ext || 'RAW'
}

export function looksLikeBinaryChange(file: ChangeEntry): boolean {
  if (isBinaryChange(file)) return true
  // Legacy entries without contentEncoding: short non-diff summaries
  return (
    file.diffText.startsWith('Binary file') ||
    (!file.diffText.startsWith('@@') &&
      !file.diffText.startsWith('+') &&
      !file.diffText.startsWith('-') &&
      file.diffText.length < 120)
  )
}

export function BinaryChangeCard({
  file,
  compact = false
}: {
  file: ChangeEntry
  compact?: boolean
}): React.JSX.Element {
  const t = useT()
  const kind = kindLabel(file.filePath)
  const before = byteLength(file, 'before')
  const after = byteLength(file, 'after')
  const changeLabel =
    file.changeType === 'added'
      ? t('review.typeAdded')
      : file.changeType === 'deleted'
        ? t('review.typeDeleted')
        : t('review.typeModified')

  const hint =
    /\.pdf$/i.test(file.filePath)
      ? t('review.binaryPdfHint')
      : /\.(docx?|xlsx?|pptx?)$/i.test(file.filePath)
        ? t('review.binaryOfficeHint')
        : /\.(png|jpe?g|gif|webp|svg|ico|heic)$/i.test(file.filePath)
          ? t('review.binaryImageHint')
          : t('review.binaryOtherHint')

  return (
    <div className={`review-binary${compact ? ' is-compact' : ''}`}>
      <div className="review-binary-badge">{t('review.binaryRawLabel')}</div>
      <div className="review-binary-meta">
        <div className="kv-row">
          <span className="kv-label">{t('review.binaryFile')}</span>
          <span className="kv-value" title={file.filePath}>
            {file.relativePath || basename(file.filePath)}
          </span>
        </div>
        <div className="kv-row">
          <span className="kv-label">{t('review.binaryKind')}</span>
          <span className="kv-value">
            {kind} · {changeLabel}
          </span>
        </div>
        <div className="kv-row">
          <span className="kv-label">{t('review.binaryBefore')}</span>
          <span className="kv-value">{before == null ? '—' : formatBytes(before)}</span>
        </div>
        <div className="kv-row">
          <span className="kv-label">{t('review.binaryAfter')}</span>
          <span className="kv-value">
            {file.changeType === 'deleted' ? '—' : formatBytes(after ?? 0)}
          </span>
        </div>
      </div>
      {!compact && <p className="muted tiny review-binary-hint">{hint}</p>}
      {compact && file.diffText ? (
        <p className="muted tiny review-binary-summary">{file.diffText}</p>
      ) : null}
    </div>
  )
}
