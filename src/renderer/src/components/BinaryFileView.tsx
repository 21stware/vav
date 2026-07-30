import { ExternalLink, File, FolderOpen } from 'lucide-react'
import type { BinaryFileMeta, FileInspectResult } from '@shared/ipc'
import { formatBytes } from '../lib/format'
import { useT } from '../i18n/useT'
import { Button } from './ui'
import { getResolvedLocale } from '../i18n/useT'

function formatWhen(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—'
  try {
    return new Date(ms).toLocaleString(getResolvedLocale())
  } catch {
    return new Date(ms).toISOString()
  }
}

export function BinaryFileView({
  info,
  meta,
  onOpenWithDefault,
  onReveal
}: {
  info: FileInspectResult
  meta?: BinaryFileMeta | null
  onOpenWithDefault: () => void | Promise<void>
  onReveal: () => void | Promise<void>
}): React.JSX.Element {
  const t = useT()
  const defaultApp = meta?.defaultApp?.trim() || null
  const openLabel = defaultApp
    ? t('preview.openWithApp', { app: defaultApp })
    : t('preview.openWithDefault')
  const mime = info.mime && info.mime !== 'text/plain' ? info.mime : 'application/octet-stream'

  const rows: { label: string; value: string }[] = [
    { label: t('preview.meta.name'), value: info.name },
    { label: t('preview.meta.path'), value: info.path },
    {
      label: t('preview.meta.size'),
      value: `${formatBytes(info.size)} (${info.size.toLocaleString()} bytes)`
    },
    {
      label: t('preview.meta.type'),
      value: `Binary (${mime})`
    },
    { label: t('preview.meta.uti'), value: meta?.uti ?? 'public.data' },
    { label: t('preview.meta.created'), value: formatWhen(meta?.createdAt) },
    {
      label: t('preview.meta.modified'),
      value: formatWhen(meta?.modifiedAt ?? info.mtimeMs ?? null)
    },
    {
      label: t('preview.meta.defaultApp'),
      value: defaultApp || t('preview.meta.defaultAppUnknown')
    },
    { label: t('preview.meta.permissions'), value: meta?.permissions || '—' },
    { label: t('preview.meta.owner'), value: meta?.owner || '—' },
    { label: t('preview.meta.inode'), value: meta?.inode || '—' }
  ]

  return (
    <div className="binary-file-view">
      {/* Spec mock used a second external-link glyph; it was decorative-only and
          confused people — single file icon is enough; action is the button. */}
      <div className="binary-file-icons" aria-hidden>
        <File size={52} strokeWidth={1.25} className="binary-file-icon-main" />
      </div>
      <div className="binary-file-title-block">
        <div className="binary-file-name" title={info.name}>
          {info.name}
        </div>
        <span className="binary-file-badge">{t('preview.binaryBadge')}</span>
      </div>
      <p className="binary-file-desc muted">{t('preview.unsupportedDescFull')}</p>
      <div className="binary-file-divider" />
      <dl className="binary-file-kv">
        {rows.map((row) => (
          <div key={row.label} className="binary-file-kv-row">
            <dt>{row.label}</dt>
            <dd title={row.value}>{row.value}</dd>
          </div>
        ))}
      </dl>
      <div className="binary-file-actions">
        <Button
          label={openLabel}
          size="sm"
          variant="primary"
          icon={<ExternalLink size={13} />}
          title={openLabel}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void onOpenWithDefault()
          }}
        />
        <Button
          label={t('preview.showInFinder')}
          size="sm"
          variant="secondary"
          icon={<FolderOpen size={13} />}
          title={t('preview.showInFinder')}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void onReveal()
          }}
        />
      </div>
    </div>
  )
}
