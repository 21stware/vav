import { useEffect, useMemo, useState } from 'react'
import type { FileInspectResult } from '@shared/ipc'
import { formatBytes } from '../lib/format'
import { highlightCode, languageFromPath } from '../lib/highlightCode'
import { useT } from '../i18n/useT'
import { Button } from './ui'

/**
 * File preview body for the standalone preview window (files-panel.rpml pin 5).
 * The window itself is owned by main; closing destroys the content (no cache).
 */
export function FileViewer({ path }: { path: string }): React.JSX.Element {
  const t = useT()
  const [info, setInfo] = useState<FileInspectResult | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.vav.files.inspect(path).then((result) => {
      if (!cancelled) {
        setInfo(result)
        if (result.name) document.title = result.name
      }
    })
    return () => {
      cancelled = true
    }
  }, [path])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        window.close()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const meta = useMemo(() => {
    if (!info) return t('common.loading')
    const parts: string[] = []
    if (info.lineCount != null) parts.push(t('files.lines', { n: info.lineCount }))
    if (info.size) parts.push(formatBytes(info.size))
    if (info.kind === 'csv') parts.push('CSV')
    else if (info.kind === 'text') parts.push('Text')
    else if (info.kind === 'image') parts.push('Image')
    else if (info.kind === 'pdf') parts.push('PDF')
    else if (info.kind === 'audio') parts.push('Audio')
    else if (info.kind === 'video') parts.push('Video')
    if (info.truncated) parts.push(t('common.truncated'))
    return parts.join(' · ')
  }, [info, t])

  const canCopySave = info?.kind === 'text' || info?.kind === 'csv'

  const highlighted = useMemo(() => {
    if (!info || info.kind !== 'text' || info.text == null) return null
    const language = languageFromPath(info.path || path)
    return highlightCode(info.text, language)
  }, [info, path])

  return (
    <div className="file-viewer-window" aria-label={info?.name ?? t('files.previewTitle')}>
      {/* Whole header is a drag region; only action buttons opt out. */}
      <div className="file-viewer-header titlebar-drag">
        <div className="file-viewer-titles">
          <div className="file-viewer-name">{info?.name ?? '…'}</div>
          <div className="file-viewer-meta muted tiny">{meta}</div>
        </div>
        <div className="file-viewer-actions titlebar-no-drag">
          {canCopySave && info?.text != null && (
            <>
              <Button
                label={copied ? t('common.copied') : t('common.copy')}
                size="sm"
                onClick={() => {
                  void window.vav.conversations.copyToClipboard(info.text ?? '').then(() => {
                    setCopied(true)
                    window.setTimeout(() => setCopied(false), 1200)
                  })
                }}
              />
              <Button
                label="Save as file"
                size="sm"
                onClick={() => void window.vav.files.saveAs(info.name, info.text ?? '')}
              />
            </>
          )}
          {(info?.kind === 'pdf' || info?.error) && (
            <Button
              label={t('files.quickLook')}
              size="sm"
              onClick={() => void window.vav.files.quickLook(path)}
            />
          )}
        </div>
      </div>

      <div className="file-viewer-body">
        {!info && <div className="muted">{t('common.loading')}</div>}
        {info?.error && info.kind !== 'pdf' && (
          <div className="muted">
            {info.error}
            <div style={{ marginTop: 8 }}>
              <Button
                label={t('files.openQuickLook')}
                size="sm"
                onClick={() => void window.vav.files.quickLook(path)}
              />
            </div>
          </div>
        )}
        {info && !info.error && info.kind === 'text' && highlighted != null && (
          <pre className="file-viewer-code">
            <code
              className="hljs"
              dangerouslySetInnerHTML={{ __html: highlighted }}
            />
          </pre>
        )}
        {info && !info.error && info.kind === 'csv' && <CsvTable text={info.text ?? ''} />}
        {info && info.dataUrl && info.kind === 'image' && (
          <img className="file-viewer-media" src={info.dataUrl} alt={info.name} />
        )}
        {info && info.dataUrl && info.kind === 'audio' && (
          <audio className="file-viewer-media" controls src={info.dataUrl} />
        )}
        {info && info.dataUrl && info.kind === 'video' && (
          <video className="file-viewer-media" controls src={info.dataUrl} />
        )}
        {info && info.kind === 'pdf' && (
          <iframe
            className="file-viewer-pdf"
            title={info.name}
            src={`vav-local://preview/?path=${encodeURIComponent(path)}`}
          />
        )}
      </div>
    </div>
  )
}

function CsvTable({ text }: { text: string }): React.JSX.Element {
  const t = useT()
  const rows = text
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map(parseCsvLine)
  if (rows.length === 0) return <div className="muted">{t('common.empty')}</div>
  const [header, ...body] = rows
  return (
    <div className="table-scroll file-viewer-table">
      <table>
        <thead>
          <tr>
            {header.map((cell, index) => (
              <th key={index}>{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else if (ch === '"') {
        quoted = false
      } else {
        current += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      cells.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  cells.push(current)
  return cells
}
