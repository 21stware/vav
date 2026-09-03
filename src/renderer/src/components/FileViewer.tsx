import {
  Suspense,
  lazy,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import {
  ChevronDown,
  Clock,
  Plus,
  Save,
  X
} from 'lucide-react'
import type { FileAssociationStatus, FileInspectResult, FileSessionMeta } from '@shared/ipc'
import { isClipPath } from '@shared/clipPath'
import type { PreviewRef } from '@shared/types'
import { formatBytes, relativeTime } from '../lib/format'
import {
  formatBadge,
  parseBlocksForPath,
  parseCsvModel,
  pickBlockAtLine,
  findBlockById,
  lineBlockAt,
  type PreviewBlock
} from '../lib/previewBlocks'
import { basename, dirname } from '../lib/path'
import {
  applyFileDraftContent,
  blockToRef,
  clampPanelWidth,
  collectBlocks,
  filesHostConversationId,
  fileViewerAgentPanelOpen,
  isOpenFilePath as filePathIsOpen,
  loadPanelWidth,
  mergeIncomingTextBody,
  mergeTextWindowInspect,
  nextCommentCardsOnBlockPick,
  persistPanelWidth,
  previewBlocksFromSqliteTables,
  previewBlocksFromZipEntries,
  provisionalInspect,
  pathsEqual,
  upsertCommentCard
} from '../lib/fileViewerHelpers'
import { convertEditProfileFor, fileViewerKindFlags, isBinaryOfficeKind, isPreviewKindSelectable } from '../lib/fileViewerKinds'
import { AgentPanelToggleButton } from './fileViewer/AgentPanelToggleButton'
import { CsvView } from './fileViewer/CsvView'
import { DocumentView } from './fileViewer/DocumentView'
import { ImageZoomStage, MediaSelectFrame } from './fileViewer/MediaStages'
import { SessionHistoryPopover } from './SessionHistoryPopover'
import { previewOpenElapsed } from '../lib/previewOpenClock'
import { createWarmComponent } from '../lib/warmComponent'
import type { OfficeNativeView as OfficeNativeViewType } from './office/OfficeNativeView'
import { fileManagerLabel } from '../lib/platform'
import { FileManagerIcon } from './FileManagerIcon'
import { isPickGestureActive, type ClickPickPointer } from '../lib/clickPick'
import { suppressHyperlinkClick } from '../lib/suppressHyperlinks'
import { useT } from '../i18n/useT'
import { useSessionStore } from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import type { FileSessionChromeProps } from './SessionDetail'
import { menuAnchor, showMenu } from '../lib/nativeMenu'
import { Button, EmptyState, InlineAlert } from './ui'
import { BinaryFileView } from './BinaryFileView'
import {
  BinaryOpenToolbar,
  ForcedBinaryTextView,
  HexDumpView,
  type BinaryOpenMode
} from './BinaryOpenViews'
import { isSilentPreviewWindowWarning } from '@shared/previewWarnings'
import type { StructuredDocument } from '@shared/structuredDoc'
import { SelectionChrome } from './SelectionChrome'
import { DocZoomControls } from './office/DocZoomControls'
import { useTextZoom } from '../lib/useTextZoom'
import { TEXT_ZOOM_MAX, TEXT_ZOOM_MIN, TEXT_ZOOM_STEP } from '../lib/docZoom'
import {
  isMediaPreviewKind,
  isMediaPreviewPath,
  shouldArmUnsavedFromExternalChange
} from '../lib/previewDirty'

// The agent side panel drags in the whole chat surface (composer, transcript,
// xterm). A preview that is never asked for an agent must not parse it.
const SessionDetail = lazy(() =>
  import('./SessionDetail').then((m) => ({ default: m.SessionDetail }))
)

// Heavy format canvases — keep out of the chat / settings critical path.
// Warm handle rather than `lazy`: the router is resident in a warm shell, and a
// Suspense fallback would cost React's ~300 ms reveal throttle.
const officeRouter = createWarmComponent<React.ComponentProps<typeof OfficeNativeViewType>>(
  () => import('./office/OfficeNativeView').then((m) => m.OfficeNativeView)
)
const StructuredDocView = lazy(() =>
  import('./StructuredDocView').then((m) => ({ default: m.StructuredDocView }))
)
const HtmlNativeView = lazy(() =>
  import('./office/HtmlNativeView').then((m) => ({ default: m.HtmlNativeView }))
)
const HtmlClipFrame = lazy(() =>
  import('./HtmlClipFrame').then((m) => ({ default: m.HtmlClipFrame }))
)
const SqliteView = lazy(() => import('./SqliteView').then((m) => ({ default: m.SqliteView })))
const MindMapView = lazy(() =>
  import('./diagram/MindMapView').then((m) => ({ default: m.MindMapView }))
)
const DiagramFileView = lazy(() =>
  import('./diagram/DiagramFileView').then((m) => ({ default: m.DiagramFileView }))
)
const DrawioView = lazy(() =>
  import('./diagram/DrawioView').then((m) => ({ default: m.DrawioView }))
)
const ZipArchiveView = lazy(() =>
  import('./ZipArchiveView').then((m) => ({ default: m.ZipArchiveView }))
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

const EMPTY_COMMENT_CARDS: { ref: PreviewRef; comment: string }[] = []

type UnsavedIntent = 'close'

/**
 * File preview (file-preview.rpml).
 * Preview and Edit share the same rendered canvas. Edit adds DevTools-style
 * block selection for Agent context — never swaps into a source/code editor.
 */
export function FileViewer({
  path: initialPath,
  parentConversationId,
  embedded = false,
  agentPanelOpen: agentPanelOpenProp,
  onToggleAgentPanel,
  onPickBlock,
  shellLeading = null,
  onClose = null
}: {
  path: string
  origin?: 'dock' | 'session'
  parentConversationId?: string | null
  /** Workspace view: no titlebar drag chrome / no nested agent drawer. */
  embedded?: boolean
  /** Workspace split-pane: agent column open (for toolbar toggle). */
  agentPanelOpen?: boolean
  onToggleAgentPanel?: () => void
  /** Optional hook after a canvas block pick (selection only — does not open Agent). */
  onPickBlock?: () => void
  /**
   * Workspace + collapsed sidebar: panel toggle / new session ahead of the
   * file name (traffic lights sit over this column).
   */
  shellLeading?: ReactNode
  /** Embedded side preview: close control in the header trailing edge. */
  onClose?: (() => void) | null
}): React.JSX.Element {
  const t = useT()
  const [filePath, setFilePath] = useState(initialPath)
  const [info, setInfo] = useState<FileInspectResult | null>(null)
  /** Standalone drawer open state (embedded uses agentPanelOpenProp from parent). */
  // Instant-open: Agent stays collapsed until the user expands it (T3 deferred).
  const [localAgentOpen, setLocalAgentOpen] = useState(false)
  /** Progressive structured index (block-pick) while native canvas paints. */
  const [structuredPreview, setStructuredPreview] = useState<StructuredDocument | null>(null)
  const [nativeOfficeReady, setNativeOfficeReady] = useState(false)
  /**
   * Standalone: local drawer. FileSessionView: parent toggle.
   * Workspace peek: agent column is always a sibling (no toggle prop) → treat open.
   */
  const agentPanelOpen = fileViewerAgentPanelOpen({
    embedded,
    hasToggle: !!onToggleAgentPanel,
    propOpen: agentPanelOpenProp,
    localOpen: localAgentOpen
  })
  const [panelWidth, setPanelWidth] = useState(loadPanelWidth)
  const panelWidthRef = useRef(panelWidth)
  panelWidthRef.current = panelWidth
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  /** Spec: Read-only toggle — blocks *writing* (Save + agent write tools), not block pick. */
  const [readOnly, setReadOnly] = useState(false)
  /**
   * Standalone preview: FileSessionStore (path/inode keyed, multi-session).
   * Embedded workspace: share the workspace/agent conversation from parent.
   */
  const [agentConversationId, setAgentConversationId] = useState<string | null>(
    embedded ? (parentConversationId ?? null) : null
  )
  const [fileId, setFileId] = useState<string | null>(null)
  const [fileSessions, setFileSessions] = useState<FileSessionMeta[]>([])
  const [sessionTitle, setSessionTitle] = useState('New session')
  const [historyOpen, setHistoryOpen] = useState(false)
  const historyAnchorRef = useRef<HTMLButtonElement | null>(null)
  const [baselineContent, setBaselineContent] = useState<string | null>(null)
  const [workingContent, setWorkingContent] = useState<string | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  /** Forces OfficeNativeView to re-read disk after an external/agent rewrite. */
  const [previewRevision, setPreviewRevision] = useState(0)
  const officeRevTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [assoc, setAssoc] = useState<FileAssociationStatus | null>(null)
  /**
   * Ephemeral binary override (text / hex). Never persisted — resets every
   * time the open path changes so we don't remember a preference.
   */
  const [binaryOpenAs, setBinaryOpenAs] = useState<BinaryOpenMode | null>(null)
  /** Prevent stacking native sheets if close is re-triggered while one is open. */
  const unsavedPromptOpen = useRef(false)
  /** Blocks picked from mature office/PDF renderers (DOM / sheet). */
  const officeBlocksRef = useRef<Map<string, PreviewBlock>>(new Map())
  const OfficeNativeView = officeRouter.use()
  const selectConversation = useSessionStore((s) => s.selectConversation)
  const createConversation = useSessionStore((s) => s.createConversation)
  const agentCommentCards = useSessionStore((s) => {
    const id = agentConversationId ?? parentConversationId ?? null
    return id ? (s.commentCards[id] ?? EMPTY_COMMENT_CARDS) : EMPTY_COMMENT_CARDS
  })
  const conversations = useSessionStore((s) => s.conversations)
  const showDialog = useSessionStore((s) => s.showDialog)
  const showToast = useSessionStore((s) => s.showToast)
  const filePathRef = useRef(filePath)
  filePathRef.current = filePath
  const hasUnsavedRef = useRef(hasUnsavedChanges)
  hasUnsavedRef.current = hasUnsavedChanges
  /** Latest file-session id for sandbox I/O — must not retrigger the open effect. */
  const hostConversationIdRef = useRef<string | undefined>(undefined)
  hostConversationIdRef.current = filesHostConversationId(
    agentConversationId,
    parentConversationId,
    useSessionStore.getState().activeId
  )
  const applyingOwnWrite = useRef(false)
  /** Silent progressive text fill — scroll-driven, no UI affordance. */
  const textWindowFillRef = useRef<{
    path: string
    endByte: number
    totalBytes: number
    busy: boolean
  } | null>(null)
  /** Last known size+mtime from inspect — ignore sibling-file dirty events. */
  const knownIdentityRef = useRef<{ size: number; mtimeMs: number } | null>(null)

  // Workspace view (and any parent) may change `path` without remounting.
  // Do not key this off local `filePath` — Save As updates that independently.
  // Skip closing the agent on the *first* mount so open-with-conversationId
  // (file-preview window) keeps the panel open from useState's initializer.
  const prevInitialPathRef = useRef<string | null>(null)
  useEffect(() => {
    const pathChanged =
      prevInitialPathRef.current !== null && prevInitialPathRef.current !== initialPath
    prevInitialPathRef.current = initialPath
    setFilePath(initialPath)
    setInfo(provisionalInspect(initialPath))
    setStructuredPreview(null)
    setNativeOfficeReady(false)
    if (pathChanged) setLocalAgentOpen(false)
    setSelectedIds([])
    setWorkingContent(null)
    setBaselineContent(null)
    setHasUnsavedChanges(false)
    setPreviewRevision(0)
    unsavedPromptOpen.current = false
    officeBlocksRef.current.clear()
    markViewer(`path:${basename(initialPath)}`)
  }, [initialPath])

  const refreshAssoc = useCallback(async (): Promise<void> => {
    const status = await window.vav.settings.fileAssociationForPath(filePathRef.current)
    setAssoc(status)
  }, [])

  useEffect(() => {
    void refreshAssoc()
  }, [filePath, refreshAssoc])

  const reloadInfo = useCallback(async (path: string): Promise<FileInspectResult> => {
    const result = await window.vav.files.inspect(path, hostConversationIdRef.current)
    setInfo(result)
    knownIdentityRef.current = {
      size: result.size,
      mtimeMs: result.mtimeMs ?? 0
    }
    if (result.name && !embedded) document.title = result.name
    return result
  }, [embedded])

  /**
   * Text-only soft baseline for dirty detect. Office Discard uses the working-copy
   * service (real is never mutated until Save), so no in-memory binary baseline.
   */
  const captureBaseline = useCallback(
    async (
      _path: string,
      kind: FileInspectResult['kind'] | undefined,
      text: string | null | undefined
    ) => {
      if (isBinaryOfficeKind(kind)) {
        setBaselineContent(null)
        return
      }
      if (text != null) setBaselineContent(text)
    },
    []
  )

  /** Agent/shell rewrote the open file on disk — refresh canvas + maybe mark dirty. */
  const handleExternalFileChange = useCallback(
    async (sourcePath?: string): Promise<void> => {
      if (applyingOwnWrite.current) return
      const current = filePathRef.current
      if (sourcePath && !(await isOpenFilePath(current, sourcePath))) return
      const prev = knownIdentityRef.current
      const result = await reloadInfo(current)
      const sameIdentity =
        prev != null &&
        prev.size === result.size &&
        prev.mtimeMs === (result.mtimeMs ?? 0)
      // Text body for text/csv/html; office uses structured plainText only for blocks.
      if (
        result.kind === 'text' ||
        result.kind === 'csv' ||
        result.kind === 'html' ||
        result.kind === 'html-clip'
      ) {
        if (result.text != null) {
          const incoming = result.text
          setWorkingContent((prevText) =>
            mergeIncomingTextBody(prevText, incoming, !!result.truncated)
          )
        }
      }
      const st = isMediaPreviewKind(result.kind)
        ? await window.vav.files.workingCopyStatus?.(current)
        : null
      const armDirty = shouldArmUnsavedFromExternalChange({
        kind: result.kind,
        hadPriorIdentity: prev != null,
        identityChanged: !sameIdentity,
        namedSource: !!sourcePath,
        workingCopyDirty: !!st?.dirty
      })
      if (armDirty) setHasUnsavedChanges(true)
      // Always bump office canvas when identity moved; also bump when fs-changed
      // named this exact path even if mtime resolution is coarse.
      if (isBinaryOfficeKind(result.kind) && (!sameIdentity || !!sourcePath)) {
        if (officeRevTimer.current) clearTimeout(officeRevTimer.current)
        officeRevTimer.current = setTimeout(() => {
          officeRevTimer.current = null
          setPreviewRevision((n) => n + 1)
        }, 120)
      }
    },
    [reloadInfo, isBinaryOfficeKind]
  )

  /**
   * Append the next byte window of the open text file. No UI — scroll near end
   * or background fill-to-EOF after open. Product: no "load more" control.
   */
  const extendTextWindow = useCallback(async (opts?: { force?: boolean }): Promise<void> => {
    const state = textWindowFillRef.current
    if (!state || state.busy) return
    if (state.path !== filePathRef.current) return
    if (hasUnsavedRef.current && !opts?.force) return
    if (state.endByte >= state.totalBytes) return
    state.busy = true
    try {
      const win = await window.vav.files.readTextWindow(state.path, {
        startByte: state.endByte,
        maxBytes: 2 * 1024 * 1024,
        conversationId: hostConversationIdRef.current
      })
      if (win.error || state.path !== filePathRef.current) return
      if (hasUnsavedRef.current) return
      if (win.content) {
        setWorkingContent((prev) => (prev ?? '') + win.content)
        setBaselineContent((prev) => (prev ?? '') + win.content)
        setInfo((prev) => mergeTextWindowInspect(prev, state.path, win.content, win))
      }
      state.endByte = win.endByte
      state.totalBytes = win.totalBytes
      // Keep filling until EOF (yield so paint/scroll stay responsive).
      if (win.truncated && win.endByte < win.totalBytes) {
        state.busy = false
        const schedule =
          typeof requestIdleCallback === 'function'
            ? (fn: () => void) => requestIdleCallback(() => fn(), { timeout: 120 })
            : (fn: () => void) => window.setTimeout(fn, 0)
        schedule(() => {
          if (textWindowFillRef.current === state) void extendTextWindow({ force: true })
        })
        return
      }
    } finally {
      if (textWindowFillRef.current === state) state.busy = false
    }
  }, [])

  useEffect(() => {
    setBinaryOpenAs(null)
  }, [filePath])

  const openedPathRef = useRef(filePath)
  useEffect(() => {
    let cancelled = false
    textWindowFillRef.current = null
    // Save As / convert-Edit update local filePath without remounting. Reset
    // the office handoff so StructuredDocView can cover first paint again.
    if (openedPathRef.current !== filePath) {
      openedPathRef.current = filePath
      setStructuredPreview(null)
      setNativeOfficeReady(false)
    }
    const provisional = provisionalInspect(filePath)
    if (provisional) {
      setInfo((prev) =>
        prev?.path === filePath && prev.kind === provisional.kind ? prev : provisional
      )
      markViewer(`provisional:${provisional.kind}`)
      markViewer('first-paint')
    }
    void reloadInfo(filePath).then(async (result) => {
      if (cancelled) return
      markViewer(`inspect:${result.kind}`)
      if (
        result.kind === 'text' ||
        result.kind === 'csv' ||
        result.kind === 'html' ||
        result.kind === 'html-clip'
      ) {
        if (result.text != null) {
          setWorkingContent(result.text)
          // Baseline deferred until Edit / Agent open — keep a soft copy for dirty detect.
          setBaselineContent(result.text)
        }
        markViewer('first-paint')
        if (result.truncated && result.textWindow) {
          textWindowFillRef.current = {
            path: filePath,
            endByte: result.textWindow.endByte,
            totalBytes: result.textWindow.totalBytes,
            busy: false
          }
          if (result.textWindow.totalBytes > result.textWindow.endByte) {
            void extendTextWindow({ force: true })
          }
        } else {
          textWindowFillRef.current = null
        }
      } else if (isBinaryOfficeKind(result.kind)) {
        // plainText is an index, not the file body — never use it for Save/Discard.
        setWorkingContent(null)
        setBaselineContent(null)
        // Capture open-time bytes so Discard can restore even before Agent opens.
        // Also used as a safety net if working-copy discard is unavailable.
        void captureBaseline(filePath, result.kind, null)
        // Progressive structured index for block-pick (does not block native canvas).
        void window.vav.files
          .inspectStructured?.(filePath, {
            conversationId: hostConversationIdRef.current,
            maxBlocks:
              result.kind === 'docx'
                ? 48
                : result.kind === 'pptx'
                  ? 1
                  : result.kind === 'pdf'
                    ? 2
                    : undefined,
            maxRows: result.kind === 'xlsx' ? 120 : undefined
          })
          .then((chunk) => {
            if (cancelled || !chunk || !chunk.ok) return
            setStructuredPreview(chunk.structured)
            setInfo((prev) =>
              prev?.path === filePath
                ? { ...prev, structured: chunk.structured, text: chunk.structured.plainText }
                : prev
            )
            markViewer('structured:partial')
            if (chunk.partial) {
              void window.vav.files.inspectStructured?.(filePath, {
                conversationId: hostConversationIdRef.current
              }).then((full) => {
                if (cancelled || !full?.ok) return
                setStructuredPreview(full.structured)
                setInfo((prev) =>
                  prev?.path === filePath
                    ? { ...prev, structured: full.structured, text: full.structured.plainText }
                    : prev
                )
                markViewer('structured:full')
              })
            }
          })
      } else if (result.text != null) {
        setWorkingContent(result.text)
        setBaselineContent(result.text)
      }
      setHasUnsavedChanges(false)
      if (result.kind !== 'pdf' && result.kind !== 'docx' && result.kind !== 'xlsx' && result.kind !== 'pptx') {
        setPreviewRevision(0)
      }
    })
    return () => {
      cancelled = true
    }
  }, [filePath, reloadInfo, isBinaryOfficeKind, extendTextWindow, captureBaseline])

  useEffect(() => {
    persistPanelWidth(panelWidth)
  }, [panelWidth])

  useEffect(() => {
    void window.vav.window.setPreviewCloseGuard(hasUnsavedChanges)
  }, [hasUnsavedChanges])

  useEffect(() => {
    return () => {
      if (officeRevTimer.current) clearTimeout(officeRevTimer.current)
    }
  }, [])

  /**
   * Agent fs_write / Change Review — and any tool that emits fs-changed.
   * Always listen while this file is open (embedded workspace never flips local
   * agentPanelOpen, so gating on that left DOCX edits invisible).
   *
   * Turn end: officecli often writes the sandboxed copy under userData (no
   * workdir watcher). Refresh dirty + canvas when the working copy moved.
   */
  useEffect(() => {
    return window.vav.agent.onEvent((event) => {
      if (event.type === 'fs-changed') {
        void handleExternalFileChange(event.filePath)
        return
      }
      if (event.type === 'file-draft') {
        if (applyingOwnWrite.current) return
        // Media canvases are not text editors — a draft would arm Save/Discard
        // with no baseline and trap the window.
        if (isMediaPreviewPath(filePathRef.current)) return
        const apply = (): void => {
          setWorkingContent((prev) => applyFileDraftContent(prev, event))
          setHasUnsavedChanges(true)
        }
        if (pathsEqual(filePathRef.current, event.filePath)) {
          apply()
          return
        }
        void (async () => {
          if (!(await isOpenFilePath(filePathRef.current, event.filePath))) return
          apply()
        })()
        return
      }
      if (event.type !== 'end') return
      void (async () => {
        if (applyingOwnWrite.current) return
        const st = await window.vav.files.workingCopyStatus?.(filePathRef.current)
        if (st?.dirty) {
          setHasUnsavedChanges(true)
          setPreviewRevision((n) => n + 1)
          await reloadInfo(filePathRef.current)
        }
      })()
    })
  }, [handleExternalFileChange, reloadInfo])

  /**
   * Shell/python-docx edits don't emit fs-changed. Workspace dir watchers still
   * fire filesDirty — only react when THIS file's mtime/size actually changed.
   */
  useEffect(() => {
    return window.vav.files.onDirty((event) => {
      const parent = dirname(filePathRef.current)
      if (!event.dirs.some((d) => pathsEqual(d, parent))) return
      void (async () => {
        if (applyingOwnWrite.current) return
        const prev = knownIdentityRef.current
        const probe = await window.vav.files.inspect(
          filePathRef.current,
          hostConversationIdRef.current
        )
        if (prev == null) {
          // First sighting while inspect is still in flight — record identity
          // only. Treating this as a rewrite marks a just-opened image dirty
          // with no baseline, and Discard cannot unstick the window.
          knownIdentityRef.current = {
            size: probe.size,
            mtimeMs: probe.mtimeMs ?? 0
          }
          return
        }
        if (prev.size === probe.size && prev.mtimeMs === (probe.mtimeMs ?? 0)) {
          // Sibling churn only — our open file is unchanged.
          return
        }
        await handleExternalFileChange()
      })()
    })
  }, [handleExternalFileChange])

  const displayText = workingContent ?? info?.text ?? ''
  const deferredDisplayText = useDeferredValue(displayText)
  const {
    isMarkdown,
    isNotebook,
    isCsv,
    isSqlite,
    isMindMap,
    isMermaidFile,
    isDotFile,
    isDrawioFile,
    isDiagramCanvas,
    lineOriented,
    isOfficeKind,
    isHtmlKind,
    isHtmlClipKind,
    isZip,
    bodyPad,
    textZoomable,
    isHeic,
    isLegacyOffice,
    formatLockedReadOnly,
    hardForcedReadOnly,
    forcedReadOnly
  } = fileViewerKindFlags({
    filePath,
    kind: info?.kind,
    mime: info?.mime,
    displayText,
    error: info?.error,
    hasInfo: !!info
  })
  const badge = formatBadge(filePath, info?.kind ?? 'text')
  // Single parse shared by block pick + window sheet (avoids double work on open).
  const csvModel = useMemo(
    () => (isCsv ? parseCsvModel(displayText) : null),
    [isCsv, displayText]
  )

  const effectiveReadOnly = readOnly || forcedReadOnly

  /**
   * Default mode on open / path change:
   * - Write for anything editable in place (text, code, md, images, docx/xlsx/pptx, …)
   * - Read only when convert is required (legacy Office, PDF, HEIC) or format is non-editable
   */
  useEffect(() => {
    setReadOnly(hardForcedReadOnly || formatLockedReadOnly)
  }, [filePath, hardForcedReadOnly, formatLockedReadOnly])

  // Keep main-process conversation.fileReadOnly in sync so the agent tool list
  // strips write tools for the entire session (not only after a manual toggle).
  useEffect(() => {
    if (!agentConversationId) return
    if (typeof window.vav.fileSessions?.setReadOnly !== 'function') return
    void window.vav.fileSessions.setReadOnly(agentConversationId, effectiveReadOnly)
  }, [agentConversationId, effectiveReadOnly])

  // Agent `switch_mode` (or another window) flipped Read/Edit — mirror chrome.
  useEffect(() => {
    if (!agentConversationId) return
    if (typeof window.vav.fileSessions?.onReadOnlyChanged !== 'function') return
    return window.vav.fileSessions.onReadOnlyChanged(({ sessionId, readOnly: next }) => {
      if (sessionId !== agentConversationId) return
      // Hard-forced formats cannot leave Read.
      if (!next && forcedReadOnly) return
      setReadOnly(next)
    })
  }, [agentConversationId, forcedReadOnly])

  const syncBlocks = useMemo((): PreviewBlock[] => {
    if (info?.structured?.blocks?.length) return info.structured.blocks
    if (isSqlite && info?.sqlite?.tables?.length) {
      return previewBlocksFromSqliteTables(info.sqlite.tables)
    }
    if (isZip && info?.zip?.entries?.length) {
      return previewBlocksFromZipEntries(info.zip.entries)
    }
    if (info?.text == null && workingContent == null) return []
    // CSV: only col + table stubs (no per-row tree). Sheet body uses the same model.
    if (isCsv) return csvModel?.blocks.filter((b) => b.kind !== 'table') ?? []
    return parseBlocksForPath(filePath, deferredDisplayText)
  }, [deferredDisplayText, info, filePath, isCsv, isSqlite, isZip, workingContent, csvModel])

  const rootBlocks = syncBlocks

  const allBlocks = useMemo(() => collectBlocks(rootBlocks), [rootBlocks])

  const mediaSrc = info?.streamUrl || info?.dataUrl || null
  const mediaBlock = useMemo((): PreviewBlock | null => {
    if (!info || !mediaSrc) return null
    return {
      id: 'media',
      kind: 'paragraph',
      text: `${info.kind}: ${filePath}`,
      startLine: 0,
      endLine: 0,
      label: info.name
    }
  }, [info, filePath, mediaSrc])

  const selectedBlocks = useMemo(() => {
    if (mediaBlock && selectedIds.includes(mediaBlock.id)) return [mediaBlock]
    // Deduplicate by id: heading trees keep the same inner blocks under both
    // the heading and the heading-section node.
    const wanted = new Set(selectedIds)
    const seen = new Set<string>()
    const out: PreviewBlock[] = []
    for (const b of allBlocks) {
      if (!wanted.has(b.id) || seen.has(b.id)) continue
      seen.add(b.id)
      out.push(b)
    }
    // CSV rows/cells are built on pick and live outside the static block tree.
    for (const id of selectedIds) {
      if (seen.has(id)) continue
      const stored = officeBlocksRef.current.get(id)
      if (!stored) continue
      seen.add(id)
      out.push(stored)
    }
    return out
  }, [allBlocks, selectedIds, mediaBlock])

  /**
   * Block pick for Agent context. By default works in Read and Edit; a setting
   * can make Read view/copy-only (pick then requires Edit).
   * Read always blocks *writing* the file (tools + Save).
   */
  const pickConversationId = agentConversationId ?? parentConversationId ?? null
  const allowReadModeSelection = useSessionStore(
    (s) => s.settings.previewReadModeSelection !== false
  )
  const showSelectionAgentMark = useSessionStore(
    (s) => s.settings.previewSelectionAgentMark !== false
  )
  const kindSelectable =
    !!info && !info.error && isPreviewKindSelectable(info.kind, !!mediaSrc)
  const selectable =
    kindSelectable && (!effectiveReadOnly || allowReadModeSelection)

  // Drop stale picks when Read-mode selection is turned off.
  useEffect(() => {
    if (!selectable && selectedIds.length > 0) setSelectedIds([])
  }, [selectable, selectedIds.length])

  /**
   * Pointer-down creates/toggles a comment card (same for MD / TS / office).
   * Called from deferred click-pick (mouseup) — event may be a plain pointer snap.
   */
  const applySelection = (
    id: string,
    event?: React.MouseEvent | MouseEvent | ClickPickPointer | null,
    hint?: PreviewBlock
  ): void => {
    if (!selectable) return
    // Prefer left-button only when the caller still has a live event.
    if (event && 'button' in event && typeof event.button === 'number' && event.button !== 0) {
      return
    }
    // Do NOT preventDefault — that blocks native text selection / copy.
    // Nested regions stopPropagation at mousedown via handleClickPickMouseDown.

    if (hint) officeBlocksRef.current.set(hint.id, hint)

    const block =
      hint ??
      officeBlocksRef.current.get(id) ??
      (mediaBlock && id === mediaBlock.id ? mediaBlock : findBlockById(rootBlocks, id))
    if (!block) return

    const run = async (): Promise<void> => {
      let conversationId = pickConversationId
      if (!conversationId) {
        conversationId = await ensureFileSession()
        if (!conversationId) return
        setAgentConversationId(conversationId)
      }

      const existing = useSessionStore.getState().commentCards[conversationId] ?? []
      const ref = blockToRef(filePath, badge, block)
      // Re-click same block → cancel (spec: 再次单击取消).
      const picked = nextCommentCardsOnBlockPick(existing, filePath, id, ref)
      useSessionStore.getState().setCommentCards(conversationId, picked.cards)
      // Paint canvas selection first; focus/panel open reflows preview (PPTX
      // windowed remount) and used to feel like click → blur → second click.
      setSelectedIds(picked.selectedIds)
      if (picked.cancelled) return
      // CLI agents: selection (+ optional vav draft) into the prompt — no submit.
      void import('../lib/cliFocusHandoff').then(({ handoffBlockToCli }) => {
        handoffBlockToCli(conversationId, ref)
      })
      // Selection only — do not expand the agent panel on click. Focus the
      // comment card if the panel is already open; skip if another pick gesture
      // already started (focus thrash between canvas and comment).
      requestAnimationFrame(() => {
        if (isPickGestureActive()) return
        onPickBlock?.()
        requestAnimationFrame(() => {
          if (isPickGestureActive()) return
          useSessionStore.getState().focusCommentCard(ref.id)
        })
      })
    }
    void run()
  }

  const onOfficePick = useCallback(
    (block: PreviewBlock, event?: MouseEvent | ClickPickPointer | null): void => {
      applySelection(block.id, event ?? null, block)
    },
    // applySelection closes over latest path/state each render
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectable, pickConversationId, filePath, badge, rootBlocks, mediaBlock]
  )

  // Removing a comment card (✕) should drop the canvas selection too.
  useEffect(() => {
    if (!selectable && !agentCommentCards.length) return
    const prefix = `${filePath}::`
    const ids = agentCommentCards
      .filter((c) => c.ref.id.startsWith(prefix))
      .map((c) => c.ref.id.slice(prefix.length))
    setSelectedIds((prev) => {
      if (prev.length === ids.length && prev.every((id, i) => id === ids[i])) return prev
      return ids
    })
  }, [agentCommentCards, filePath, selectable])

  const selectByLine = (
    line: number,
    event?: React.MouseEvent | ClickPickPointer | null
  ): void => {
    if (lineOriented) {
      const block = lineBlockAt(line, displayText)
      if (block) applySelection(block.id, event, block)
      return
    }
    const hit = pickBlockAtLine(rootBlocks, line, displayText)
    if (hit) applySelection(hit.id, event, hit)
  }

  // Comment cards own selection in file preview — no separate preview-ref chips.

  /** Hide Agent only — keep Edit picks / comment cards for when it reopens. */
  const closeAgentPanel = (): void => {
    setLocalAgentOpen(false)
  }

  const openInMainPanel = (): void => {
    void (async () => {
      let id = agentConversationId ?? parentConversationId
      if (!id) id = await ensureFileSession()
      if (!id) return
      const api = window.vav?.window?.revealInList
      if (typeof api !== 'function') {
        console.error('[preview] revealInList unavailable — rebuild preload')
        return
      }
      void api(id)
    })()
  }

  /**
   * Open/restore a chat for this file. Prefer FileSessionStore; fall back to
   * parent conversation or a normal create so the agent panel never goes blank
   * (missing IPC after HMR would otherwise leave only the empty state).
   */
  const ensureFileSession = async (): Promise<string | null> => {
    // Temp conversation clips are preview windows — never bind a File Session.
    if (isClipPath(filePath)) {
      if (parentConversationId) {
        setAgentConversationId(parentConversationId)
        await selectConversation(parentConversationId)
        const meta = useSessionStore
          .getState()
          .conversations.find((c) => c.id === parentConversationId)
        setSessionTitle(meta?.title || t('common.session'))
        await prepareFileWorkspace(parentConversationId, filePath)
        return parentConversationId
      }
      return null
    }

    // 1) FileSessionStore (preferred — multi-session, hidden from sidebar)
    try {
      if (typeof window.vav.fileSessions?.open === 'function') {
        const state = await window.vav.fileSessions.open(filePath)
        if (state) {
          setFileId(state.fileId)
          setFileSessions(state.sessions)
          setAgentConversationId(state.activeSessionId)
          const active = state.sessions.find((s) => s.id === state.activeSessionId)
          setSessionTitle(active?.title || 'New session')
          await selectConversation(state.activeSessionId)
          const meta = useSessionStore
            .getState()
            .conversations.find((c) => c.id === state.activeSessionId)
          if (meta?.title) setSessionTitle(meta.title)
          try {
            // Prefer effectiveReadOnly (format lock / forced RO), not the stale local flag.
            await window.vav.fileSessions.setReadOnly(
              state.activeSessionId,
              forcedReadOnly || readOnly
            )
          } catch {
            // optional on older main
          }
          await prepareFileWorkspace(state.activeSessionId, filePath)
          return state.activeSessionId
        }
      }
    } catch (err) {
      console.error('[file-sessions] open failed, falling back', err)
    }

    // 2) Session-originated preview: use the parent conversation
    if (parentConversationId) {
      setAgentConversationId(parentConversationId)
      await selectConversation(parentConversationId)
      const meta = useSessionStore
        .getState()
        .conversations.find((c) => c.id === parentConversationId)
      setSessionTitle(meta?.title || t('common.session'))
      await prepareFileWorkspace(parentConversationId, filePath)
      return parentConversationId
    }

    // 3) Last resort: mint a normal conversation in this file's directory
    await createConversation({ workingDirectory: dirname(filePath), openIn: 'here' })
    const id = useSessionStore.getState().activeId
    if (!id) return null
    setAgentConversationId(id)
    setSessionTitle('New session')
    await prepareFileWorkspace(id, filePath)
    return id
  }

  /**
   * Workspace = enclosed directory of the open file. Point the (collapsed) Files
   * tray at that root and select this file — do not expand the tray by default.
   *
   * Workspace View already owns a project root: never shrink it to the file's
   * parent (that cleared the Files tree and looked like a flicker on every click).
   */
  const prepareFileWorkspace = async (
    conversationId: string,
    path: string
  ): Promise<void> => {
    const dir = dirname(path)
    const store = useSessionStore.getState()
    const meta = store.conversations.find((c) => c.id === conversationId)
    // Session already rooted at a project that contains this file — only
    // highlight the path (right preview drawer). Never shrink the Files tree.
    const root = meta?.workingDirectory ?? null
    const underSessionRoot =
      !!root &&
      !root.startsWith('__') &&
      (path === root || path.startsWith(`${root}/`) || path.startsWith(`${root}\\`))

    if (underSessionRoot) {
      useWorkspaceStore.getState().selectPath(conversationId, path)
      return
    }

    // Always bind workdir for Enclosed dir chip; missing dirs surface a calm
    // empty state in FilesPanel (ENOENT → "dir not exist"), not a raw error.
    if ((meta?.workingDirectory ?? null) !== dir) {
      await store.setWorkingDirectory(conversationId, dir)
    } else {
      await useWorkspaceStore.getState().setWorkingDirectory(conversationId, dir)
    }
    useWorkspaceStore.getState().selectPath(conversationId, path)
    // Prefer Files segment when the user later expands tools, but stay collapsed.
    // Quiet merges from toolsLayouts — if storage still says expanded, it would
    // open the tray. Re-read after awaits so we preserve a mid-session open tray,
    // and re-assert collapse when the tray was already folded.
    const wasCollapsed = useSessionStore.getState().toolsCollapsed
    store.setPanelSegmentQuiet('files')
    if (wasCollapsed) store.setToolsCollapsed(true)
    // Path chip shows "Enclosed dir" until the user explicitly switches workdir.
    store.markEnclosedDirChip(conversationId)
  }

  // Embedded (FileSessionView / Workspace Peek): bind parent + enclosed-dir tray.
  // Standalone uses ensureFileSession on mount instead.
  useEffect(() => {
    if (!embedded) return
    setAgentConversationId(parentConversationId ?? null)
    if (parentConversationId && filePath) {
      void prepareFileWorkspace(parentConversationId, filePath)
    }
    // prepareFileWorkspace is recreated each render; only re-bind on identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, parentConversationId, filePath])

  // Instant-open: do NOT hydrate file sessions on mount — wait for Agent expand.
  // (ensureFileSession runs from toggleAgentPanel / explicit actions.)

  // Keep session title in sync with store renames / auto-title.
  useEffect(() => {
    if (!agentConversationId) return
    const meta = conversations.find((c) => c.id === agentConversationId)
    if (meta?.title) setSessionTitle(meta.title)
  }, [conversations, agentConversationId])

  // Composer / Transcript key off store.activeId — keep it glued to the file
  // session so Enter-to-send and draft state match the panel (not a stale
  // main-sidebar selection).
  useEffect(() => {
    if (!agentConversationId) return
    if (useSessionStore.getState().activeId === agentConversationId) return
    void selectConversation(agentConversationId)
  }, [agentConversationId, selectConversation])

  // File Attachment Chip: auto-attach on open / path change / re-open preview.
  // Dismiss (✕) only clears context — this effect re-runs when filePath or
  // session id changes, restoring the chip per file-preview.rpml.
  useEffect(() => {
    if (!agentConversationId || !filePath) return
    void useSessionStore.getState().attachContextFile(agentConversationId, filePath)
  }, [agentConversationId, filePath])

  const toggleAgentPanel = async (): Promise<void> => {
    if (agentPanelOpen) {
      // Collapsing the agent column must not ask to Save/Discard — dirty buffer
      // stays on the file canvas until the user Saves or closes the window.
      closeAgentPanel()
      onToggleAgentPanel?.()
      return
    }

    // Ensure document sandbox so agent edits never hit the real path.
    // Save promotes; Discard drops the copy (real file untouched).
    if (isBinaryOfficeKind(info?.kind) && window.vav.files.workingCopyEnsure) {
      const ensured = await window.vav.files.workingCopyEnsure(filePath, {
        fileId: fileId
      })
      if (!ensured.ok) {
        showToast({
          kind: 'error',
          title: t('preview.saveFailed'),
          description: ensured.error
        })
      } else if (!hasUnsavedChanges) {
        setPreviewRevision((n) => n + 1)
      }
    }
    if (!hasUnsavedChanges) {
      if (isBinaryOfficeKind(info?.kind)) {
        await captureBaseline(filePath, info?.kind, null)
        setWorkingContent(null)
      } else {
        const text = info?.text ?? workingContent ?? ''
        setBaselineContent(text)
        setWorkingContent(text)
      }
      setHasUnsavedChanges(false)
    }
    setLocalAgentOpen(true)

    const id = (await ensureFileSession()) ?? agentConversationId
    if (id) {
      setAgentConversationId(id)
      // Comment cards already hold picks — clear legacy composer Reference chips.
      useSessionStore.getState().clearPreviewRefs(id)
      // Prefer the pending comment field so blur doesn't fight the pick; only
      // land in the main draft when there is no open card.
      const cards = useSessionStore.getState().commentCards[id] ?? []
      const pending = cards.find((c) => !c.comment.trim()) ?? cards[cards.length - 1]
      if (pending) {
        useSessionStore.getState().focusCommentCard(pending.ref.id)
      } else {
        useSessionStore.getState().focusComposer()
      }
    } else {
      useSessionStore.getState().focusComposer()
    }
  }

  const newFileSession = async (): Promise<void> => {
    if (isClipPath(filePath)) return
    try {
      if (typeof window.vav.fileSessions?.create === 'function') {
        const state = await window.vav.fileSessions.create(filePath)
        if (!state) return
        setFileId(state.fileId)
        setFileSessions(state.sessions)
        setAgentConversationId(state.activeSessionId)
        setSessionTitle('New session')
        await selectConversation(state.activeSessionId)
        try {
          await window.vav.fileSessions.setReadOnly(state.activeSessionId, readOnly)
        } catch {
          // ignore
        }
        await prepareFileWorkspace(state.activeSessionId, filePath)
        useSessionStore.getState().focusComposer()
        return
      }
      // Fallback without FileSessionStore
      await createConversation({ workingDirectory: dirname(filePath), openIn: 'here' })
      const id = useSessionStore.getState().activeId
      if (id) {
        setAgentConversationId(id)
        setSessionTitle('New session')
        await prepareFileWorkspace(id, filePath)
        useSessionStore.getState().focusComposer()
      }
    } catch (err) {
      showToast({ kind: 'error', title: t('preview.sessionFailed'), description: String(err) })
    }
  }

  const switchFileSession = async (sessionId: string): Promise<void> => {
    if (!fileId || !sessionId || sessionId === agentConversationId) return
    try {
      const state = await window.vav.fileSessions.setActive(fileId, sessionId)
      if (!state) return
      setFileSessions(state.sessions)
      setAgentConversationId(state.activeSessionId)
      const active = state.sessions.find((s) => s.id === state.activeSessionId)
      setSessionTitle(active?.title || 'New session')
      await selectConversation(state.activeSessionId)
      try {
        await window.vav.fileSessions.setReadOnly(state.activeSessionId, effectiveReadOnly)
      } catch {
        // ignore
      }
      await prepareFileWorkspace(state.activeSessionId, filePath)
    } catch (err) {
      showToast({
        kind: 'error',
        title: t('preview.sessionFailed'),
        description: (err as Error).message
      })
    }
  }

  const renameFileSession = async (sessionId: string, title: string): Promise<void> => {
    if (!fileId) return
    try {
      const state = await window.vav.fileSessions.rename(fileId, sessionId, title)
      if (!state) return
      setFileSessions(state.sessions)
      if (sessionId === agentConversationId) {
        setSessionTitle(title.trim().slice(0, 100) || 'New session')
      }
    } catch (err) {
      showToast({
        kind: 'error',
        title: t('preview.sessionFailed'),
        description: (err as Error).message
      })
    }
  }

  const deleteFileSessions = (sessionIds: string[]): void => {
    if (!fileId || sessionIds.length === 0) return
    const targets = fileSessions.filter((s) => sessionIds.includes(s.id))
    if (targets.length === 0) return
    const single = targets.length === 1
    const totalMessages = targets.reduce((n, s) => n + (s.messageCount ?? 0), 0)
    const title = single
      ? t('dialog.deleteSession')
      : t('dialog.deleteSessions', { count: targets.length })
    const detail = single
      ? [
          t('preview.sessionDeleteWarn'),
          '',
          `${t('preview.sessionLabel')}: ${targets[0]!.title}`,
          `${t('preview.sessionMessages', { n: targets[0]!.messageCount ?? 0 })}`,
          `${t('preview.sessionCreated')}: ${relativeTime(targets[0]!.createdAt)}`
        ].join('\n')
      : [
          t('preview.sessionDeleteBulkWarn', {
            count: targets.length,
            messages: totalMessages
          }),
          '',
          ...targets.map((s) => `• ${s.title} (${s.messageCount ?? 0})`)
        ].join('\n')

    showDialog({
      title,
      body: detail,
      confirmLabel: t('common.delete'),
      destructive: true,
      onConfirm: () => {
        void (async () => {
          try {
            const result = await window.vav.fileSessions.delete(fileId, sessionIds)
            if (!result) {
              showToast({ kind: 'error', title: t('preview.sessionDeleteFailed') })
              return
            }
            if (!result.ok) {
              const msg =
                result.error === 'active_protected'
                  ? t('preview.sessionCannotDeleteActive')
                  : result.error === 'last_protected'
                    ? t('preview.sessionCannotDeleteLast')
                    : t('preview.sessionDeleteFailed')
              showToast({ kind: 'error', title: msg })
              return
            }
            setFileSessions(result.sessions)
            if (result.activeSessionId !== agentConversationId) {
              setAgentConversationId(result.activeSessionId)
              const active = result.sessions.find((s) => s.id === result.activeSessionId)
              setSessionTitle(active?.title || 'New session')
              await selectConversation(result.activeSessionId)
            }
            const n = result.removed.length
            showToast({
              kind: 'success',
              title:
                n === 1
                  ? t('preview.sessionDeletedOne', { name: targets[0]?.title ?? '' })
                  : t('preview.sessionDeletedMany', { n, messages: totalMessages })
            })
          } catch (err) {
            showToast({
              kind: 'error',
              title: t('preview.sessionDeleteFailed'),
              description: (err as Error).message
            })
          }
        })()
      }
    })
  }

  /**
   * HEIC / Office: editing means convert + Save As (not in-place write).
   * Returns profile for the dialog + binary source path.
   */
  const convertEditProfile = useMemo(
    () =>
      convertEditProfileFor(filePath, {
        kind: info?.kind,
        contentPath: info?.contentPath,
        isHeic,
        isLegacyOffice
      }),
    [filePath, info?.contentPath, info?.kind, isHeic, isLegacyOffice]
  )

  const convertAndSaveAs = async (): Promise<boolean> => {
    const profile = convertEditProfile
    if (!profile) return false
    applyingOwnWrite.current = true
    try {
      const bin = await window.vav.files.readBinary(
        profile.sourcePath,
        filesHostConversationId(agentConversationId, parentConversationId)
      )
      if (!bin.ok) {
        showToast({
          kind: 'error',
          title: t('preview.convertEditFailed'),
          description: bin.error
        })
        return false
      }
      const result = await window.vav.files.saveAs(profile.suggestedPath, '')
      if (!result.ok) {
        if (!result.cancelled) {
          showToast({
            kind: 'error',
            title: t('preview.convertEditFailed'),
            description: result.error
          })
        }
        return false
      }
      const written = await window.vav.files.writeBinary(result.path, bin.base64)
      if (!written.ok) {
        showToast({
          kind: 'error',
          title: t('preview.convertEditFailed'),
          description: written.error
        })
        return false
      }
      // Original stays untouched — open the new file for editing.
      setFilePath(result.path)
      setReadOnly(false)
      setHasUnsavedChanges(false)
      await reloadInfo(result.path)
      setPreviewRevision((n) => n + 1)
      showToast({ kind: 'success', title: t('preview.saved') })
      return true
    } finally {
      window.setTimeout(() => {
        applyingOwnWrite.current = false
      }, 400)
    }
  }

  const applyReadOnly = (on: boolean): void => {
    if (hardForcedReadOnly && !on) return
    // Format-locked (HEIC / Office): Edit → convert + Save As, not in-place.
    if (!on && formatLockedReadOnly) {
      const profile = convertEditProfile
      if (!profile) {
        showToast({ kind: 'error', title: t('preview.convertEditFailed') })
        return
      }
      const formatLabel = t(`preview.convertFormat.${profile.formatKey}`)
      showDialog({
        title: t('preview.convertEditTitle'),
        body: t('preview.convertEditBody', {
          name: info?.name ?? basename(filePath),
          format: formatLabel
        }),
        confirmLabel: t('preview.convertEditConfirm', { format: formatLabel }),
        onConfirm: () => {
          void convertAndSaveAs()
        }
      })
      return
    }
    setReadOnly(on)
    // Keep block picks / comment cards when entering Read — agent can still
    // discuss selected content; write tools stay disabled via fileReadOnly.
    if (agentConversationId && typeof window.vav.fileSessions?.setReadOnly === 'function') {
      void window.vav.fileSessions.setReadOnly(agentConversationId, on)
    }
  }

  /** Offer “Always open .{ext} with vav” only when not already the default. */
  const onSetAsDefault = (): void => {
    if (!assoc || assoc.isVav) return
    showDialog({
      title: t('assoc.setTitle', { label: assoc.label }),
      body: t('assoc.setBody', {
        label: assoc.label,
        ext: assoc.extensions.join(', '),
        current: assoc.defaultApp || t('assoc.unset')
      }),
      confirmLabel: t('assoc.setAsDefault'),
      onConfirm: () => {
        void (async () => {
          try {
            await window.vav.settings.setFileAssociation(assoc.id)
            await refreshAssoc()
            showToast({
              kind: 'success',
              title: t('assoc.setSuccess', { label: assoc.label })
            })
          } catch (err) {
            showToast({
              kind: 'error',
              title: t('assoc.setFailed'),
              description: (err as Error).message
            })
          }
        })()
      }
    })
  }

  /**
   * Save / Discard contract (office + sandboxed paths):
   *
   * - real path: only written by promote (Save / Accept)
   * - working copy: all agent/tool/preview I/O while sandboxed
   * - Save  = ensure(attach) → promote(working → real)
   * - Discard = drop working, re-seed from real (real never held edits)
   */
  const save = async (): Promise<boolean> => {
    applyingOwnWrite.current = true
    try {
      if (isBinaryOfficeKind(info?.kind)) {
        if (!window.vav.files.workingCopyEnsure || !window.vav.files.workingCopyPromote) {
          showToast({
            kind: 'error',
            title: t('preview.saveFailed'),
            description: 'working-copy API unavailable — rebuild preload'
          })
          return false
        }
        // Attach existing working (or recover from disk). Never wipes edits.
        const ensured = await window.vav.files.workingCopyEnsure(filePath, {
          fileId: fileId
        })
        if (!ensured.ok) {
          showToast({
            kind: 'error',
            title: t('preview.saveFailed'),
            description: ensured.error
          })
          return false
        }
        const promoted = await window.vav.files.workingCopyPromote(filePath)
        if (!promoted.ok) {
          showToast({
            kind: 'error',
            title: t('preview.saveFailed'),
            description: promoted.error
          })
          return false
        }
        // After promote, working === real; soft baseline for UI only.
        await captureBaseline(filePath, info?.kind, null)
        setHasUnsavedChanges(false)
        await reloadInfo(filePath)
        setPreviewRevision((n) => n + 1)
        showToast({ kind: 'success', title: t('preview.saved') })
        return true
      }

      // Text: flush editor buffer into the I/O path (sandbox if active), then promote.
      const content = workingContent ?? info?.text ?? ''
      const result = await window.vav.files.write(
        filePath,
        content,
        filesHostConversationId(agentConversationId, parentConversationId)
      )
      if (!result.ok) {
        showToast({
          kind: 'error',
          title: t('preview.saveFailed'),
          description: result.error
        })
        return false
      }
      if (window.vav.files.workingCopyPromote) {
        const st = await window.vav.files.workingCopyStatus?.(filePath)
        if (st) {
          const promoted = await window.vav.files.workingCopyPromote(filePath)
          if (!promoted.ok) {
            showToast({
              kind: 'error',
              title: t('preview.saveFailed'),
              description: promoted.error
            })
            return false
          }
        }
      }
      setBaselineContent(content)
      setHasUnsavedChanges(false)
      await reloadInfo(filePath)
      showToast({ kind: 'success', title: t('preview.saved') })
      return true
    } finally {
      window.setTimeout(() => {
        applyingOwnWrite.current = false
      }, 400)
    }
  }

  const saveAs = async (): Promise<boolean> => {
    if (isBinaryOfficeKind(info?.kind)) {
      // Working content (sandbox if active) → new real path. Original real is
      // untouched under the sandbox model (never held agent edits).
      applyingOwnWrite.current = true
      try {
        const bin = await window.vav.files.readBinary(
          filePath,
          filesHostConversationId(agentConversationId, parentConversationId)
        )
        if (!bin.ok) {
          showToast({
            kind: 'error',
            title: t('preview.saveFailed'),
            description: bin.error
          })
          return false
        }
        const originalPath = filePath
        const result = await window.vav.files.saveAs(originalPath, '')
        if (!result.ok) {
          if (!result.cancelled) {
            showToast({
              kind: 'error',
              title: t('preview.saveFailed'),
              description: result.error
            })
          }
          return false
        }
        // New path is not sandboxed — writeBinary hits the real new file.
        const written = await window.vav.files.writeBinary(result.path, bin.base64)
        if (!written.ok) {
          showToast({
            kind: 'error',
            title: t('preview.saveFailed'),
            description: written.error
          })
          return false
        }
        // Drop sandbox for the old path so we don't leave a dirty clone behind.
        if (window.vav.files.workingCopyDiscard && result.path !== originalPath) {
          await window.vav.files.workingCopyDiscard(originalPath)
        }
        setFilePath(result.path)
        setHasUnsavedChanges(false)
        await reloadInfo(result.path)
        setPreviewRevision((n) => n + 1)
        showToast({ kind: 'success', title: t('preview.saved') })
        return true
      } finally {
        window.setTimeout(() => {
          applyingOwnWrite.current = false
        }, 400)
      }
    }

    const content = workingContent ?? info?.text ?? ''
    const originalPath = filePath
    applyingOwnWrite.current = true
    try {
      const result = await window.vav.files.saveAs(originalPath, content)
      if (!result.ok) {
        if (!result.cancelled) {
          showToast({
            kind: 'error',
            title: t('preview.saveFailed'),
            description: result.error
          })
        }
        return false
      }
      // Sandboxed: original real was never mutated — skip restore write.
      // Legacy (no sandbox): restore original text baseline.
      const sandboxed = !!(await window.vav.files.workingCopyStatus?.(originalPath))
      if (
        !sandboxed &&
        baselineContent != null &&
        result.path !== originalPath
      ) {
        await window.vav.files.write(
          originalPath,
          baselineContent,
          filesHostConversationId(agentConversationId, parentConversationId)
        )
      }
      if (window.vav.files.workingCopyDiscard && result.path !== originalPath) {
        await window.vav.files.workingCopyDiscard(originalPath)
      }
      setFilePath(result.path)
      setBaselineContent(content)
      setWorkingContent(content)
      setHasUnsavedChanges(false)
      await reloadInfo(result.path)
      showToast({ kind: 'success', title: t('preview.saved') })
      return true
    } finally {
      window.setTimeout(() => {
        applyingOwnWrite.current = false
      }, 400)
    }
  }

  /**
   * Discard = throw away working copy and re-seed from real.
   * Real path is never written here when sandbox is active.
   */
  const discard = async (): Promise<boolean> => {
    applyingOwnWrite.current = true
    try {
      if (isBinaryOfficeKind(info?.kind)) {
        if (!window.vav.files.workingCopyDiscard) {
          showToast({
            kind: 'error',
            title: t('preview.discardFailed'),
            description: 'workingCopyDiscard unavailable — rebuild preload'
          })
          return false
        }
        const dropped = await window.vav.files.workingCopyDiscard(filePath)
        if (!dropped.ok) {
          showToast({
            kind: 'error',
            title: t('preview.discardFailed'),
            description: dropped.error
          })
          return false
        }
        await captureBaseline(filePath, info?.kind, null)
        await reloadInfo(filePath)
        setPreviewRevision((n) => n + 1)
        setHasUnsavedChanges(false)
        return true
      }

      // Text: prefer sandbox discard; else restore in-memory baseline only.
      const st = await window.vav.files.workingCopyStatus?.(filePath)
      if (st && window.vav.files.workingCopyDiscard) {
        const dropped = await window.vav.files.workingCopyDiscard(filePath)
        if (!dropped.ok) {
          showToast({
            kind: 'error',
            title: t('preview.discardFailed'),
            description: dropped.error
          })
          return false
        }
        const reloaded = await reloadInfo(filePath)
        if (reloaded.text != null) {
          setWorkingContent(reloaded.text)
          setBaselineContent(reloaded.text)
        } else if (baselineContent != null) {
          setWorkingContent(baselineContent)
        }
        setHasUnsavedChanges(false)
        return true
      }

      if (baselineContent == null) {
        // Nothing to restore (typical for a media preview that was never
        // edited). Clearing the flag unsticks close; do not trap the window.
        setWorkingContent(null)
        setHasUnsavedChanges(false)
        return true
      }
      setWorkingContent(baselineContent)
      setHasUnsavedChanges(false)
      return true
    } finally {
      window.setTimeout(() => {
        applyingOwnWrite.current = false
      }, 400)
    }
  }

  /** Tell the file session (and CLI host, if any) that the user discarded edits. */
  const notifyDiscardToAgent = async (): Promise<void> => {
    let conversationId = agentConversationId ?? parentConversationId ?? null
    if (!conversationId) {
      conversationId = await ensureFileSession()
      if (conversationId) setAgentConversationId(conversationId)
    }
    if (!conversationId) return
    const notice = t('preview.discardNotice', { path: filePath })
    await window.vav.agent.appendNotice(conversationId, notice)
    // CLI hosts: paste a brief note into the prompt buffer (no auto-submit).
    const meta = useSessionStore.getState().conversations.find((c) => c.id === conversationId)
    const agentId = meta?.agentBinaryName
    if (agentId && agentId !== 'vav') {
      useWorkspaceStore.getState().injectContextToActivePane(conversationId, notice, {
        submit: false,
        delayMs: 80
      })
    }
  }

  /**
   * Save ▾ → Discard Changes: confirm, restore baseline, notify agent context.
   */
  const confirmDiscardChanges = async (): Promise<void> => {
    if (!hasUnsavedChanges) return
    const name = info?.name ?? basename(filePath)
    const response = await window.vav.dialog.messageBox({
      type: 'warning',
      title: t('preview.discardConfirmTitle'),
      message: t('preview.discardConfirmTitle'),
      detail: t('preview.discardConfirmBody', { name }),
      buttons: [t('preview.discardConfirmAction'), t('common.cancel')],
      defaultId: 1,
      cancelId: 1
    })
    if (response !== 0) return
    const ok = await discard()
    if (!ok) return
    showToast({ kind: 'success', title: t('preview.discarded') })
    await notifyDiscardToAgent()
  }

  /**
   * Native Save / Cancel / Discard sheet (macOS: buttons[0] is rightmost primary).
   * Only for closing the preview window — not for collapsing the agent panel.
   */
  const promptUnsaved = useCallback(
    async (_intent: UnsavedIntent): Promise<void> => {
      if (unsavedPromptOpen.current) return
      unsavedPromptOpen.current = true
      try {
        const name = info?.name ?? basename(filePath)
        const detail = [t('preview.unsavedBody', { name }), t('preview.unsavedHint')]
          .filter(Boolean)
          .join('\n\n')
        // Order: Save (primary) · Cancel · Discard
        const response = await window.vav.dialog.messageBox({
          type: 'warning',
          title: t('preview.unsavedTitle'),
          message: t('preview.unsavedTitle'),
          detail,
          buttons: [t('preview.save'), t('common.cancel'), t('preview.discard')],
          defaultId: 0,
          cancelId: 1
        })
        if (response === 0) {
          const ok = await save()
          if (!ok) return
          void window.vav.window.forcePreviewClose()
          return
        }
        if (response === 2) {
          const ok = await discard()
          if (!ok) return
          void notifyDiscardToAgent()
          void window.vav.window.setPreviewCloseGuard(false)
          void window.vav.window.forcePreviewClose()
        }
        // Cancel (1) or dismiss — stay put.
      } finally {
        unsavedPromptOpen.current = false
      }
    },
    // save/discard close over latest filePath/content via state in the same render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filePath, info?.name, t, hasUnsavedChanges, baselineContent, workingContent]
  )

  useEffect(() => {
    return window.vav.window.onPreviewCloseAttempt(() => {
      void promptUnsaved('close')
    })
  }, [promptUnsaved])

  const requestClose = (): void => {
    if (hasUnsavedChanges) {
      void promptUnsaved('close')
      return
    }
    window.close()
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'w') {
        event.preventDefault()
        requestClose()
        return
      }
      // Save shortcuts apply in Editing mode (buttons hidden in Read / ZIP / binary).
      // Embedded workspace keeps agent docked without local agentPanelOpen.
      if (
        !effectiveReadOnly &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === 's'
      ) {
        event.preventDefault()
        if (event.shiftKey) void saveAs()
        else if (hasUnsavedChanges) void save()
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        const conversationId = agentConversationId ?? parentConversationId ?? null
        if (selectedIds.length > 0 || agentCommentCards.length > 0) {
          setSelectedIds([])
          if (conversationId) {
            useSessionStore.getState().clearCommentCards(conversationId)
          }
          return
        }
        if (agentPanelOpen) void toggleAgentPanel()
        else if (!embedded) window.close()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    agentPanelOpen,
    hasUnsavedChanges,
    effectiveReadOnly,
    agentConversationId,
    parentConversationId,
    embedded,
    selectedIds.length,
    agentCommentCards.length
  ])

  const statusLeft = useMemo(() => {
    if (!info) return t('common.loading')
    const parts: string[] = []
    if (info.kind === 'zip' && info.zip) {
      parts.push(
        `${formatBytes(info.zip.compressedSize)} (${formatBytes(info.zip.uncompressedSize)} uncompressed)`
      )
      parts.push(t('preview.zipEntries', { n: info.zip.entryCount }))
      parts.push(t('preview.zipRatio', { n: info.zip.ratio }))
      parts.push(badge)
      parts.push(filePath)
      if (info.mtimeMs) {
        parts.push(
          t('preview.modifiedAt', {
            when: new Date(info.mtimeMs).toLocaleDateString()
          })
        )
      }
      return parts.join(' · ')
    }
    if (info.kind === 'binary') {
      if (info.size) parts.push(formatBytes(info.size))
      parts.push(badge)
      parts.push(filePath)
      if (info.mtimeMs) {
        parts.push(
          t('preview.modifiedAt', {
            when: new Date(info.mtimeMs).toLocaleDateString()
          })
        )
      }
      return parts.join(' · ')
    }
    if (info.size) parts.push(formatBytes(info.size))
    if (info.kind === 'csv' && csvModel) {
      parts.push(
        csvModel.rowCapped
          ? t('preview.csvSheetCapped', {
              shown: csvModel.rows.length,
              total: csvModel.totalRows,
              cols: csvModel.headers.length
            })
          : t('preview.csvSheet', {
              rows: csvModel.totalRows,
              cols: csvModel.headers.length
            })
      )
    } else if (info.lineCount != null) {
      parts.push(t('files.lines', { n: info.lineCount }))
    }
    parts.push(badge)
    parts.push(filePath)
    // Never surface technical windowing as "truncated" in the status strip.
    if (hasUnsavedChanges) parts.push('•')
    return parts.join(' · ')
  }, [info, badge, filePath, t, hasUnsavedChanges, csvModel])

  const openAgentFromToggle = (): void => {
    if (embedded && onToggleAgentPanel) {
      onToggleAgentPanel()
      return
    }
    if (!embedded) {
      void toggleAgentPanel()
      return
    }
    // Workspace drawer: agent column is already a sibling — focus the composer.
    useSessionStore.getState().focusComposer()
  }

  const onSelectionAgentMarkClick = (): void => {
    if (!agentPanelOpen && ((embedded && onToggleAgentPanel) || !embedded)) {
      openAgentFromToggle()
    }
    useSessionStore.getState().focusComposer()
  }

  const agentToggle = (
    <AgentPanelToggleButton
      open={agentPanelOpen}
      title={embedded ? t('workspace.toggleAgentPanel') : t('preview.agentPanel')}
      onClick={openAgentFromToggle}
      className={embedded ? undefined : 'titlebar-no-drag'}
    />
  )

  const previewMainRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const textZoom = useTextZoom({ hostRef: bodyRef, enabled: textZoomable })
  /** Setting on + selection + agent collapsed — hide once the panel is open. */
  const showSelectionAgentFab =
    showSelectionAgentMark && selectedIds.length > 0 && !agentPanelOpen

  const fileHeader = (
      <header
        className={`file-viewer-header${embedded ? '' : ' titlebar-drag'}${shellLeading ? ' has-shell-leading' : ''}`}
      >
        {/*
          Standalone preview: header is a window drag region. Only interactive
          controls opt out (titlebar-no-drag) — the file name stays draggable.
          Workspace + collapsed sidebar: shellLeading parks toggle/new before
          the file name so the agent column can stay flush to the window top.
        */}
        <div className="file-viewer-lead">
          {shellLeading ? (
            <div className={`file-viewer-shell-leading${embedded ? '' : ' titlebar-no-drag'}`}>
              {shellLeading}
            </div>
          ) : null}
          <span
            className={`file-viewer-name${embedded ? '' : ' titlebar-no-drag'}`}
            data-testid="file-preview-name"
            title={isClipPath(filePath) ? (info?.name ?? basename(filePath)) : filePath}
          >
            {info?.name ?? basename(filePath)}
          </span>
          <label
            className={`preview-mode${embedded ? '' : ' titlebar-no-drag'}${hardForcedReadOnly || formatLockedReadOnly ? ' is-forced' : ''}${hardForcedReadOnly ? ' is-static' : ''}`}
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
            {/* Binary / ZIP / directory: only Read — no fake Edit option or chevron. */}
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
          {/* Read: offer only when not already default. Editing: under Save ▾. */}
          {assoc && !assoc.isVav && readOnly && (
            <button
              type="button"
              className={`preview-default-text-btn${embedded ? '' : ' titlebar-no-drag'}`}
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
        <div className={`file-viewer-actions${embedded ? '' : ' titlebar-no-drag'}`}>
          {/* Save / Save As only in Editing; hidden for ZIP/binary (forced read-only). */}
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
                    const ext =
                      assoc.extensions[0]?.replace(/^\./, '') ?? assoc.label
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
                  showToast({
                    kind: 'error',
                    title: t('preview.revealFailed'),
                    description: (err as Error).message
                  })
                }
              })()
            }}
          />
          {(embedded && onToggleAgentPanel) || !embedded ? agentToggle : null}
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

  const agentColumn =
    agentPanelOpen && !embedded ? (
          <aside className="preview-agent-panel" style={{ width: panelWidth }}>
            <div
              className="preview-agent-resizer"
              onMouseDown={(event) => {
                event.preventDefault()
                const startX = event.clientX
                const startW = panelWidth
                const onMove = (e: MouseEvent): void => {
                  const next = clampPanelWidth(startW + (startX - e.clientX))
                  panelWidthRef.current = next
                  setPanelWidth(next)
                }
                const onUp = (): void => {
                  window.removeEventListener('mousemove', onMove)
                  window.removeEventListener('mouseup', onUp)
                  persistPanelWidth(panelWidthRef.current)
                }
                window.addEventListener('mousemove', onMove)
                window.addEventListener('mouseup', onUp)
              }}
            />
            {/* vav mode folds session title/history/new into AgentModeChrome.
                CLI hosts keep a dedicated bar (no search row to share). */}
            {(() => {
              const agentMeta = conversations.find((c) => c.id === agentConversationId)
              const agentIsVav =
                !agentMeta?.agentBinaryName || agentMeta.agentBinaryName === 'vav'
              const showSeparateSessionBar = !embedded && (!agentConversationId || !agentIsVav)
              const fileChrome: FileSessionChromeProps | null =
                agentConversationId && agentIsVav
                  ? {
                      title: sessionTitle,
                      sessions: fileSessions,
                      activeSessionId: agentConversationId,
                      historyOpen,
                      historyAnchorRef,
                      onToggleHistory: () => setHistoryOpen((v) => !v),
                      onCloseHistory: () => setHistoryOpen(false),
                      onSwitchSession: (id) => void switchFileSession(id),
                      onRenameSession: renameFileSession,
                      onDeleteSessions: deleteFileSessions,
                      onNewSession: () => void newFileSession()
                    }
                  : null
              return (
                <>
                  {showSeparateSessionBar && (
                    <div className="preview-file-session-bar">
                      <span className="preview-file-session-title" title={sessionTitle}>
                        {sessionTitle || t('common.session')}
                      </span>
                      <span className="spacer" />
                      <div className="preview-file-session-actions">
                        <button
                          type="button"
                          ref={historyAnchorRef}
                          className={`btn ghost sm icon-only${historyOpen ? ' is-active-toggle' : ''}`}
                          title={t('preview.sessionHistory')}
                          onClick={() => setHistoryOpen((v) => !v)}
                        >
                          <Clock size={12} />
                        </button>
                        <Button
                          icon={<Plus size={12} />}
                          size="sm"
                          variant="ghost"
                          title={t('preview.newSession')}
                          onClick={() => void newFileSession()}
                        />
                      </div>
                      <SessionHistoryPopover
                        open={historyOpen}
                        onClose={() => setHistoryOpen(false)}
                        sessions={fileSessions}
                        activeSessionId={agentConversationId}
                        onSwitch={(id) => {
                          void switchFileSession(id)
                          setHistoryOpen(false)
                        }}
                        onRename={renameFileSession}
                        onDelete={deleteFileSessions}
                        anchorRef={historyAnchorRef}
                      />
                    </div>
                  )}
                  {agentConversationId ? (
                    <Suspense fallback={<div className="muted" data-pad="text" />}>
                      <SessionDetail variant="preview-edit" fileSessionChrome={fileChrome} />
                    </Suspense>
                  ) : (
                    <EmptyState
                      title={t('preview.startChat')}
                      description={t('preview.startChatDesc')}
                    >
                      <Button
                        label={t('preview.startChat')}
                        size="sm"
                        variant="primary"
                        onClick={() => {
                          void ensureFileSession().then((id) => {
                            if (id) useSessionStore.getState().focusComposer()
                          })
                        }}
                      />
                    </EmptyState>
                  )}
                </>
              )
            })()}
          </aside>
    ) : null

  const fileBody = (
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
              {structuredPreview && !nativeOfficeReady && (
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
                  structuredPreview && !nativeOfficeReady
                    ? 'file-viewer-native-office is-pending'
                    : 'file-viewer-native-office'
                }
                aria-hidden={
                  structuredPreview && !nativeOfficeReady ? true : undefined
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
                store.setCommentCards(id, upsertCommentCard(existing, ref))
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

  const statusFooter = (
      <footer className="file-preview-statusbar">
        <span className="file-preview-status-left" title={statusLeft}>
          {statusLeft}
        </span>
      </footer>
  )

  const fileColumn = (
    <>
      {fileHeader}
      <div
        className={`file-preview-main${selectable ? ' has-selection-hud' : ''}`}
        ref={previewMainRef}
      >
        <SelectionChrome
          hostRef={previewMainRef}
          selectedIds={selectedIds}
          enabled={selectable}
          fab={
            showSelectionAgentFab
              ? {
                  title: embedded ? t('workspace.toggleAgentPanel') : t('preview.agentPanel'),
                  onClick: onSelectionAgentMarkClick
                }
              : null
          }
        />
        <div
          ref={bodyRef}
          className={`file-viewer-body${selectable ? ' selecting pick-mode' : ''}`}
          data-pad={bodyPad}
          onClickCapture={(event) => {
            // Markdown / office / HTML previews: never follow hyperlinks.
            suppressHyperlinkClick(event)
          }}
        >
          {fileBody}
        </div>
        {textZoomable ? (
          <DocZoomControls
            scale={textZoom.scale}
            atFit={textZoom.atFit}
            onZoomIn={() => textZoom.zoomBy(TEXT_ZOOM_STEP)}
            onZoomOut={() => textZoom.zoomBy(1 / TEXT_ZOOM_STEP)}
            onFit={textZoom.fit}
            minScale={TEXT_ZOOM_MIN}
            maxScale={TEXT_ZOOM_MAX}
            resetKey="preview.actualSize"
          />
        ) : null}
      </div>
      {statusFooter}
    </>
  )

  return (
    <div
      className={`file-preview-shell${agentPanelOpen && !embedded ? ' agent-open' : ''}${embedded ? ' embedded' : ''}`}
      data-testid={embedded ? undefined : 'file-preview-window'}
    >
      {embedded ? (
        fileColumn
      ) : (
        <div className="file-preview-columns">
          <section className="file-preview-file-col">{fileColumn}</section>
          {agentColumn}
        </div>
      )}
    </div>
  )
}

/** Open preview path may be the real file while the agent writes the sandbox copy. */
async function isOpenFilePath(openPath: string, sourcePath: string): Promise<boolean> {
  return filePathIsOpen(openPath, sourcePath, (path) => window.vav.files.workingCopyStatus?.(path))
}
