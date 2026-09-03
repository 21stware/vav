import type { ReactNode } from 'react'
import { ChevronDown, Save, X } from 'lucide-react'
import { isClipPath } from '@shared/clipPath'
import type { FileAssociationStatus, FileInspectResult } from '@shared/ipc'
import { basename } from '../../lib/path'
import { fileManagerLabel } from '../../lib/platform'
import { FileManagerIcon } from '../FileManagerIcon'
import { menuAnchor, showMenu } from '../../lib/nativeMenu'
import { Button } from '../ui'
import { useT } from '../../i18n/useT'

export function FileViewerHeader({
  embedded,
  shellLeading,
  filePath,
  info,
  hardForcedReadOnly,
  formatLockedReadOnly,
  isZip,
  effectiveReadOnly,
  applyReadOnly,
  assoc,
  readOnly,
  onSetAsDefault,
  hasUnsavedChanges,
  save,
  saveAs,
  confirmDiscardChanges,
  openInMainPanel,
  revealFailed,
  agentToggle,
  onClose
}: {
  embedded: boolean
  shellLeading?: ReactNode
  filePath: string
  info: FileInspectResult | null
  hardForcedReadOnly: boolean
  formatLockedReadOnly: boolean
  isZip: boolean
  effectiveReadOnly: boolean
  applyReadOnly: (next: boolean) => void
  assoc: FileAssociationStatus | null | undefined
  readOnly: boolean
  onSetAsDefault: () => void
  hasUnsavedChanges: boolean
  save: () => Promise<boolean> | void
  saveAs: () => Promise<boolean> | void
  confirmDiscardChanges: () => Promise<void> | void
  openInMainPanel: () => void
  revealFailed: (err: Error) => void
  agentToggle: ReactNode | null
  onClose?: (() => void) | null
}): React.JSX.Element {
  const t = useT()
  const noDrag = embedded ? '' : ' titlebar-no-drag'
  return (
    <header
      className={`file-viewer-header${embedded ? '' : ' titlebar-drag'}${shellLeading ? ' has-shell-leading' : ''}`}
    >
      <div className="file-viewer-lead">
        {shellLeading ? (
          <div className={`file-viewer-shell-leading${noDrag}`}>
            {shellLeading}
          </div>
        ) : null}
        <span
          className={`file-viewer-name${noDrag}`}
          data-testid="file-preview-name"
          title={isClipPath(filePath) ? (info?.name ?? basename(filePath)) : filePath}
        >
          {info?.name ?? basename(filePath)}
        </span>
        <label
          className={`preview-mode${noDrag}${hardForcedReadOnly || formatLockedReadOnly ? ' is-forced' : ''}${hardForcedReadOnly ? ' is-static' : ''}`}
          title={
            isZip
              ? t('preview.zipReadOnlyHint')
              : hardForcedReadOnly
                ? t('preview.binaryReadOnlyHint')
                : formatLockedReadOnly
                  ? t('preview.formatReadOnlyHint')
                  : undefined
          }
        >
          {hardForcedReadOnly ? (
            <span className="preview-mode-static" aria-label={t('preview.modeLabel')}>
              {t('preview.modeReadOnly')}
            </span>
          ) : (
            <span className="preview-mode-control">
              <select
                className="text-field preview-mode-select"
                value={effectiveReadOnly ? 'readonly' : 'editing'}
                aria-label={t('preview.modeLabel')}
                onChange={(e) => applyReadOnly(e.target.value === 'readonly')}
              >
                <option value="editing">{t('preview.modeEditing')}</option>
                <option value="readonly">{t('preview.modeReadOnly')}</option>
              </select>
              <ChevronDown className="preview-mode-chevron" size={12} aria-hidden />
            </span>
          )}
        </label>
        {assoc && !assoc.isVav && readOnly && (
          <button
            type="button"
            className={`preview-default-text-btn${noDrag}`}
            title={t('assoc.alwaysOpenWith', {
              ext: assoc.extensions[0]?.replace(/^\./, '') ?? assoc.label
            })}
            onClick={onSetAsDefault}
          >
            {t('assoc.alwaysOpenWith', {
              ext: assoc.extensions[0]?.replace(/^\./, '') ?? assoc.label
            })}
          </button>
        )}
      </div>
      <span className="spacer" />
      <div className={`file-viewer-actions${noDrag}`}>
        {!effectiveReadOnly && (
          <div className={`preview-save-group${hasUnsavedChanges ? ' is-dirty' : ''}`}>
            <Button
              icon={<Save size={13} />}
              label={t('preview.save')}
              variant={hasUnsavedChanges ? 'primary' : 'secondary'}
              size="sm"
              className="preview-save-main"
              disabled={!hasUnsavedChanges}
              title={`${t('preview.save')} (⌘S)`}
              onClick={() => void save()}
            />
            <Button
              icon={<ChevronDown size={14} />}
              variant={hasUnsavedChanges ? 'primary' : 'secondary'}
              size="sm"
              className="preview-save-more"
              title={t('preview.moreActions')}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                const anchor = menuAnchor(event.currentTarget as HTMLElement)
                const items: {
                  label: string
                  divider?: boolean
                  disabled?: boolean
                  onSelect?: () => void
                }[] = [
                  {
                    label: `${t('preview.saveAs')} (⌘⇧S)`,
                    onSelect: () => void saveAs()
                  }
                ]
                if (hasUnsavedChanges) {
                  items.push({
                    label: t('preview.discardChanges'),
                    onSelect: () => void confirmDiscardChanges()
                  })
                }
                if (!embedded) {
                  items.push({ label: '', divider: true })
                  items.push({
                    label: t('workspace.openInMainPanel'),
                    onSelect: () => openInMainPanel()
                  })
                }
                if (assoc && !assoc.isVav) {
                  const ext = assoc.extensions[0]?.replace(/^\./, '') ?? assoc.label
                  items.push({ label: '', divider: true })
                  items.push({
                    label: t('assoc.alwaysOpenWith', { ext }),
                    onSelect: () => onSetAsDefault()
                  })
                }
                void showMenu(items, anchor)
              }}
            />
          </div>
        )}
        <Button
          icon={<FileManagerIcon size={14} />}
          size="sm"
          className={embedded ? undefined : 'titlebar-no-drag'}
          title={t('tools.revealInFm', { fileManager: fileManagerLabel() })}
          onClick={() => {
            void (async () => {
              try {
                await window.vav.conversations.revealInFinder(filePath)
              } catch (err) {
                revealFailed(err as Error)
              }
            })()
          }}
        />
        {agentToggle}
        {embedded && onClose ? (
          <Button
            icon={<X size={14} />}
            size="sm"
            testId="file-preview-close"
            title={t('common.close')}
            onClick={onClose}
          />
        ) : null}
      </div>
    </header>
  )
}
