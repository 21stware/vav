import { Suspense, lazy } from 'react'
import type { FileAssociationStatus, FileInspectResult } from '@shared/ipc'
import { blockToRef, isSilentPreviewWindowWarning } from '../../lib/fileViewerHelpers'
import { previewOpenElapsed } from '../../lib/previewOpenClock'
import { createWarmComponent } from '../../lib/warmComponent'
import type { OfficeNativeView as OfficeNativeViewType } from '../office/OfficeNativeView'
import { CsvView } from './CsvView'
import { DocumentView } from './DocumentView'
import { ImageZoomStage, MediaSelectFrame } from './MediaStages'
import type { CsvSelectionModel, PreviewBlock } from '../../lib/previewBlocks'
import { InlineAlert } from '../ui'
import { BinaryFileView } from '../BinaryFileView'
import {
  BinaryOpenToolbar,
  ForcedBinaryTextView,
  HexDumpView,
  type BinaryOpenMode
} from '../BinaryOpenViews'
import type { StructuredDocument } from '@shared/structuredDoc'
import type { ClickPickPointer } from '../../lib/clickPick'
import { useT } from '../../i18n/useT'
import { useSessionStore } from '../../state/sessionStore'

const officeRouter = createWarmComponent<React.ComponentProps<typeof OfficeNativeViewType>>(
  () => import('../office/OfficeNativeView').then((m) => m.OfficeNativeView)
)
const StructuredDocView = lazy(() =>
  import('../StructuredDocView').then((m) => ({ default: m.StructuredDocView }))
)
const HtmlNativeView = lazy(() =>
  import('../office/HtmlNativeView').then((m) => ({ default: m.HtmlNativeView }))
)
const HtmlClipFrame = lazy(() =>
  import('../HtmlClipFrame').then((m) => ({ default: m.HtmlClipFrame }))
)
const SqliteView = lazy(() => import('../SqliteView').then((m) => ({ default: m.SqliteView })))
const MindMapView = lazy(() =>
  import('../diagram/MindMapView').then((m) => ({ default: m.MindMapView }))
)
const DiagramFileView = lazy(() =>
  import('../diagram/DiagramFileView').then((m) => ({ default: m.DiagramFileView }))
)
const DrawioView = lazy(() =>
  import('../diagram/DrawioView').then((m) => ({ default: m.DrawioView }))
)
const ZipArchiveView = lazy(() =>
  import('../ZipArchiveView').then((m) => ({ default: m.ZipArchiveView }))
)

function markViewer(label: string): void {
  try {
    performance.mark(`viewer:${label}`)
  } catch {
    // ignore
  }
  if (import.meta.env.DEV) {
    const elapsed = previewOpenElapsed()
    const since = elapsed == null ? '' : ` (+${elapsed}ms since open)`
    console.debug(`[preview-perf] viewer:${label}`, performance.now().toFixed(1), since)
  }
}

export type FileViewerCanvasProps = {
  info: FileInspectResult | null
  filePath: string
  csvModel: CsvSelectionModel | null
  selectable: boolean
  selectedIds: string[]
  setSelectedIds: (ids: string[]) => void
  applySelection: (
    id: string,
    event?: React.MouseEvent | MouseEvent | ClickPickPointer | null,
    hint?: PreviewBlock
  ) => void
  mediaSrc: string | null
  binaryOpenAs: BinaryOpenMode | null
  setBinaryOpenAs: (mode: BinaryOpenMode | null) => void
  structuredPreview: StructuredDocument | null
  nativeOfficeReady: boolean
  setNativeOfficeReady: (ready: boolean) => void
  isOfficeKind: boolean
  previewRevision: number
  onOfficePick: (block: PreviewBlock, event?: MouseEvent | ClickPickPointer | null) => void
  isHtmlKind: boolean
  isHtmlClipKind: boolean
  displayText: string
  isMindMap: boolean
  effectiveReadOnly: boolean
  isMermaidFile: boolean
  isDotFile: boolean
  isDrawioFile: boolean
  isDiagramCanvas: boolean
  isMarkdown: boolean
  isNotebook: boolean
  lineOriented: boolean
  rootBlocks: PreviewBlock[]
  selectedBlocks: PreviewBlock[]
  selectByLine: (line: number, event?: React.MouseEvent | ClickPickPointer | null) => void
  extendTextWindow: () => void
  setWorkingContent: (content: string) => void
  setHasUnsavedChanges: (dirty: boolean) => void
  baselineContent: string | null
  assoc: FileAssociationStatus | null
  agentConversationId: string | null
  parentConversationId?: string | null
  badge: string
}

/** Format-specific preview canvases (office, media, text, zip, binary). */
export function FileViewerCanvas(props: FileViewerCanvasProps): React.JSX.Element {
  const t = useT()
  const showToast = useSessionStore((s) => s.showToast)
  const OfficeNativeView = officeRouter.use()
  const {
    info,
    filePath,
    csvModel,
    selectable,
    selectedIds,
    setSelectedIds,
    applySelection,
    mediaSrc,
    binaryOpenAs,
    setBinaryOpenAs,
    structuredPreview,
    nativeOfficeReady,
    setNativeOfficeReady,
    isOfficeKind,
    previewRevision,
    onOfficePick,
    isHtmlKind,
    isHtmlClipKind,
    displayText,
    isMindMap,
    effectiveReadOnly,
    isMermaidFile,
    isDotFile,
    isDrawioFile,
    isDiagramCanvas,
    isMarkdown,
    isNotebook,
    lineOriented,
    rootBlocks,
    selectedBlocks,
    selectByLine,
    extendTextWindow,
    setWorkingContent,
    setHasUnsavedChanges,
    baselineContent,
    assoc,
    agentConversationId,
    parentConversationId,
    badge
  } = props

  return (
              <Suspense fallback={<div className="muted">{t('common.loading')}</div>}>
              <>
              {!info && <div className="muted">{t('common.loading')}</div>}
              {/* Real load failures only — zip/binary use dedicated canvases, never this alert. */}
              {info?.error && info.kind !== 'zip' && info.kind !== 'binary' && (
                <InlineAlert kind="error" title={t('preview.loadFailed')} message={info.error} />
              )}
              {info && !info.error && info.kind === 'csv' && csvModel && (
                <CsvView
                  model={csvModel}
                  selecting={selectable}
                  selectedIds={selectedIds}
                  onSelect={(id, event, hint) => applySelection(id, event, hint)}
                />
              )}
              {info && !info.error && info.kind === 'sqlite' && info.sqlite && (
                <SqliteView
                  path={filePath}
                  info={info.sqlite}
                  selecting={selectable}
                  selectedIds={selectedIds}
                  onSelect={(id, event, hint) => applySelection(id, event, hint)}
                />
              )}
              {info && mediaSrc && info.kind === 'image' && (
                <div className="file-viewer-image-scroll">
                  {/* Meta outside pick frame so EXIF rows stay text-selectable while scrolling. */}
                  {info.imageMeta && info.imageMeta.length > 0 && (
                    <div
                      className="file-viewer-image-meta-flat"
                      role="list"
                      aria-label={t('preview.imageMeta')}
                      onMouseDown={(e) => {
                        // Don't let the media pick frame steal drags that start on meta.
                        e.stopPropagation()
                      }}
                    >
                      {info.imageMeta.map((row) => (
                        <div
                          key={row.key}
                          className="file-viewer-image-meta-line"
                          role="listitem"
                          // Single line for OS copy: "Key\tValue"
                          data-meta-line={`${row.key}\t${row.value}`}
                        >
                          <span className="file-viewer-image-meta-key" title={row.key}>
                            {row.key}
                          </span>
                          <span className="file-viewer-image-meta-val" title={row.value}>
                            {row.value}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <ImageZoomStage
                    key={mediaSrc}
                    src={mediaSrc}
                    alt={info.name}
                    selecting={selectable}
                    selected={selectedIds.includes('media')}
                    onSelect={(event) => applySelection('media', event)}
                  />
                </div>
              )}
              {info && mediaSrc && info.kind === 'audio' && (
                <MediaSelectFrame
                  selecting={selectable}
                  selected={selectedIds.includes('media')}
                  onSelect={(event) => applySelection('media', event)}
                >
                  <div className="file-viewer-audio-card">
                    <div className="file-viewer-audio-name" title={info.name}>
                      {info.name}
                    </div>
                    <audio
                      className="file-viewer-media file-viewer-audio"
                      controls
                      preload="metadata"
                      src={mediaSrc}
                    />
                  </div>
                </MediaSelectFrame>
              )}
              {info && mediaSrc && info.kind === 'video' && (
                <MediaSelectFrame
                  selecting={selectable}
                  selected={selectedIds.includes('media')}
                  onSelect={(event) => applySelection('media', event)}
                >
                  <video
                    className="file-viewer-media file-viewer-video"
                    controls
                    preload="metadata"
                    src={mediaSrc}
                  />
                </MediaSelectFrame>
              )}
              {/* Audio/video with no stream URL — still show a surface instead of a blank body. */}
              {info &&
                !info.error &&
                (info.kind === 'audio' || info.kind === 'video') &&
                !mediaSrc &&
                (binaryOpenAs ? (
                  <>
                    <BinaryOpenToolbar mode={binaryOpenAs} onMode={setBinaryOpenAs} />
                    {binaryOpenAs === 'text' ? (
                      <ForcedBinaryTextView path={filePath} />
                    ) : (
                      <HexDumpView path={filePath} />
                    )}
                  </>
                ) : (
                  <BinaryFileView
                    info={info}
                    meta={info.binaryMeta ?? null}
                    onOpenWithDefault={() => void window.vav.files.openWithDefault(filePath)}
                    onReveal={() => void window.vav.conversations.revealInFinder(filePath)}
                    onOpenAs={setBinaryOpenAs}
                  />
                ))}
              {info?.warnings &&
                info.warnings.some((w) => !isSilentPreviewWindowWarning(w)) && (
                  <div className="file-viewer-warnings" role="status">
                    {info.warnings
                      .filter((w) => !isSilentPreviewWindowWarning(w))
                      .map((w) => (
                        <div key={w} className="file-viewer-warning-line muted">
                          {w}
                        </div>
                      ))}
                  </div>
                )}
              {info && !info.error && isOfficeKind && (
                <>
                  {/* Progressive structured canvas for docx/xlsx/pptx until native paints. */}
                  {structuredPreview &&
                    !nativeOfficeReady &&
                    info.kind !== 'pdf' && (
                      <Suspense fallback={null}>
                        <StructuredDocView
                          doc={structuredPreview}
                          selecting={selectable}
                          selectedIds={selectedIds}
                          onSelect={(id, event) => applySelection(id, event ?? null)}
                        />
                      </Suspense>
                    )}
                  <div
                    className={
                      structuredPreview && !nativeOfficeReady && info.kind !== 'pdf'
                        ? 'file-viewer-native-office is-pending'
                        : 'file-viewer-native-office'
                    }
                    aria-hidden={
                      structuredPreview && !nativeOfficeReady && info.kind !== 'pdf'
                        ? true
                        : undefined
                    }
                  >
                    {OfficeNativeView ? (
                      <OfficeNativeView
                        path={info.contentPath || filePath}
                        kind={info.kind}
                        revision={previewRevision}
                        selecting={selectable}
                        selectedIds={selectedIds}
                        onPick={onOfficePick}
                        onReady={() => {
                          setNativeOfficeReady(true)
                          markViewer('native-ready')
                        }}
                        progressiveStructured={structuredPreview}
                      />
                    ) : null}
                  </div>
                </>
              )}
              {info && !info.error && isHtmlKind && (
                <HtmlNativeView
                  path={info.contentPath || filePath}
                  html={displayText}
                  revision={previewRevision}
                  selecting={selectable}
                  selectedIds={selectedIds}
                  onPick={onOfficePick}
                />
              )}
              {info && !info.error && isHtmlClipKind && (
                <Suspense fallback={null}>
                  <HtmlClipFrame source={displayText} title={info.name} />
                </Suspense>
              )}
              {info && !info.error && info.kind === 'text' && isMindMap && (
                <MindMapView
                  key={filePath}
                  path={filePath}
                  text={displayText}
                  selecting={selectable}
                  selectedIds={selectedIds}
                  readOnly={effectiveReadOnly}
                  onSelect={(block, event) => applySelection(block.id, event ?? null, block)}
                  onDocChange={(serialized) => {
                    setWorkingContent(serialized)
                    setHasUnsavedChanges(serialized !== (baselineContent ?? info?.text ?? ''))
                  }}
                />
              )}
              {info && !info.error && info.kind === 'text' && isMermaidFile && (
                <DiagramFileView
                  key={filePath}
                  kind="mermaid"
                  text={displayText}
                  selecting={selectable}
                  selectedIds={selectedIds}
                  readOnly={effectiveReadOnly}
                  onSelect={(block, event) => applySelection(block.id, event ?? null, block)}
                  onSourceChange={(source) => {
                    setWorkingContent(source)
                    setHasUnsavedChanges(source !== (baselineContent ?? info?.text ?? ''))
                  }}
                />
              )}
              {info && !info.error && info.kind === 'text' && isDotFile && (
                <DiagramFileView
                  key={filePath}
                  kind="graphviz"
                  text={displayText}
                  selecting={selectable}
                  selectedIds={selectedIds}
                  readOnly={effectiveReadOnly}
                  onSelect={(block, event) => applySelection(block.id, event ?? null, block)}
                  onSourceChange={(source) => {
                    setWorkingContent(source)
                    setHasUnsavedChanges(source !== (baselineContent ?? info?.text ?? ''))
                  }}
                />
              )}
              {info && !info.error && info.kind === 'text' && isDrawioFile && (
                <DrawioView
                  key={filePath}
                  text={displayText}
                  selecting={selectable}
                  selectedIds={selectedIds}
                  onSelect={(block, event) => applySelection(block.id, event ?? null, block)}
                />
              )}
              {info && !info.error && info.kind === 'text' && !isDiagramCanvas && (
                <DocumentView
                  path={filePath}
                  text={displayText}
                  markdown={isMarkdown}
                  notebook={isNotebook}
                  lineOriented={lineOriented}
                  selecting={selectable}
                  blocks={rootBlocks}
                  selectedIds={selectedIds}
                  selectedBlocks={selectedBlocks}
                  onSelectBlock={applySelection}
                  onSelectLine={selectByLine}
                  onNearEnd={() => {
                    void extendTextWindow()
                  }}
                  onAskAgent={(prompt, target) => {
                    setSelectedIds([target.id])
                    const id =
                      agentConversationId ??
                      parentConversationId ??
                      useSessionStore.getState().activeId
                    if (!id) return
                    const store = useSessionStore.getState()
                    store.setDraft(id, prompt)
                    // Comment card (not legacy previewRefs Reference chips).
                    const ref = blockToRef(filePath, badge, target)
                    const existing = store.commentCards[id] ?? []
                    const without = existing.filter((c) => c.ref.id !== ref.id)
                    store.setCommentCards(id, [...without, { ref, comment: '' }])
                    store.clearPreviewRefs(id)
                    store.focusCommentCard(ref.id)
                    store.focusComposer()
                  }}
                />
              )}
              {info && info.kind === 'zip' && (
                <ZipArchiveView
                  name={info.name}
                  zip={
                    info.zip ?? {
                      entries: [],
                      entryCount: 0,
                      compressedSize: info.size,
                      uncompressedSize: 0,
                      ratio: 0
                    }
                  }
                  truncated={!!info.truncated || !!info.zipEncrypted}
                  selecting={selectable && !info.error}
                  selectedIds={selectedIds}
                  onSelect={(block, event) => applySelection(block.id, event, block)}
                  passwordProtected={!!info.zipEncrypted}
                />
              )}
              {info && info.kind === 'directory' && (
                <div className="muted" style={{ padding: 24, textAlign: 'center' }}>
                  {t('files.error.directory')}
                </div>
              )}
              {info &&
                info.kind === 'binary' &&
                (binaryOpenAs ? (
                  <>
                    <BinaryOpenToolbar mode={binaryOpenAs} onMode={setBinaryOpenAs} />
                    {binaryOpenAs === 'text' ? (
                      <ForcedBinaryTextView path={filePath} />
                    ) : (
                      <HexDumpView path={filePath} />
                    )}
                  </>
                ) : (
                  <BinaryFileView
                    info={info}
                    meta={{
                      ...(info.binaryMeta ?? {
                        uti: 'public.data',
                        permissions: '—',
                        owner: '—',
                        createdAt: null,
                        modifiedAt: info.mtimeMs ?? null,
                        inode: '—',
                        defaultApp: null
                      }),
                      defaultApp:
                        info.binaryMeta?.defaultApp ?? assoc?.defaultApp ?? null
                    }}
                    onOpenAs={setBinaryOpenAs}
                    onOpenWithDefault={async () => {
                      try {
                        if (typeof window.vav.files.openWithDefault !== 'function') {
                          showToast({
                            kind: 'error',
                            title: t('preview.openFailed'),
                            description: t('preview.openFailedNoApi')
                          })
                          return
                        }
                        const result = await window.vav.files.openWithDefault(filePath)
                        if (!result?.ok) {
                          showToast({
                            kind: 'error',
                            title: t('preview.openFailed'),
                            description: result && 'error' in result ? result.error : undefined
                          })
                          return
                        }
                        showToast({
                          kind: 'success',
                          title: t('preview.openLaunched')
                        })
                      } catch (err) {
                        showToast({
                          kind: 'error',
                          title: t('preview.openFailed'),
                          description: (err as Error).message
                        })
                      }
                    }}
                    onReveal={async () => {
                      try {
                        await window.vav.conversations.revealInFinder(filePath)
                      } catch (err) {
                        showToast({
                          kind: 'error',
                          title: t('preview.revealFailed'),
                          description: (err as Error).message
                        })
                      }
                    }}
                  />
                ))}
              </>
              </Suspense>
  )
}
