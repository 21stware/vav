import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import {
  ChevronDown,
  Clock,
  Plus,
  Save
} from 'lucide-react'
import type { FileAssociationStatus, FileInspectResult, FileSessionMeta } from '@shared/ipc'
import type { PreviewRef } from '@shared/types'
import { formatBytes, relativeTime } from '../lib/format'
import { highlightCode, languageFromPath } from '../lib/highlightCode'
import { MarkdownView } from './MarkdownView'
import {
  formatBadge,
  parseBlocksForPath,
  csvColId,
  csvCellBlock,
  csvRowBlock,
  parseCsvModel,
  parseNotebookBlocks,
  blockAtLine,
  findBlockById,
  parentBlockOf,
  isLineOrientedPath,
  lineBlockAt,
  type PreviewBlock
} from '../lib/previewBlocks'
import { basename, dirname, replaceExt } from '../lib/path'
import { fileManagerLabel } from '../lib/platform'
import { FileManagerIcon } from './FileManagerIcon'
import { handleClickPickMouseDown, isPickGestureActive, type ClickPickPointer } from '../lib/clickPick'
import { suppressHyperlinkClick } from '../lib/suppressHyperlinks'
import { useT } from '../i18n/useT'
import { useSessionStore } from '../state/sessionStore'
import { useWorkspaceStore } from '../state/workspaceStore'
import { SessionDetail, type FileSessionChromeProps } from './SessionDetail'
import { menuAnchor, showMenu } from '../lib/nativeMenu'
import { Button, EmptyState, InlineAlert } from './ui'
import { looksLikeFreeMind, looksLikeOpml } from '@shared/mindmap'
import { BinaryFileView } from './BinaryFileView'

// Heavy format canvases — keep out of the chat / settings critical path.
const OfficeNativeView = lazy(() =>
  import('./office/OfficeNativeView').then((m) => ({ default: m.OfficeNativeView }))
)
const HtmlNativeView = lazy(() =>
  import('./office/HtmlNativeView').then((m) => ({ default: m.HtmlNativeView }))
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
import { SessionHistoryPopover } from './SessionHistoryPopover'
import wordmark from '../assets/wordmark.png'
import wordmarkDark from '../assets/wordmark-dark.png'

const PANEL_WIDTH_KEY = 'vav.filePreviewAgentPanelWidth'
const EMPTY_COMMENT_CARDS: { ref: PreviewRef; comment: string }[] = []

function loadPanelWidth(): number {
  try {
    const n = Number(localStorage.getItem(PANEL_WIDTH_KEY))
    if (n >= 280 && n <= 520) return n
  } catch {
    // ignore
  }
  return 360
}

type UnsavedIntent = 'done' | 'close'

/**
 * File preview (file-preview.rpml).
 * Preview and Edit share the same rendered canvas. Edit adds DevTools-style
 * block selection for Agent context — never swaps into a source/code editor.
 */
/** Shared Agent panel toggle — product mark (main embedded + standalone). */
function AgentPanelToggleButton({
  open,
  title,
  onClick,
  className
}: {
  open: boolean
  title: string
  onClick: () => void
  className?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`btn ghost sm icon-only preview-agent-logo-btn${open ? ' is-active-toggle' : ''}${className ? ` ${className}` : ''}`}
      title={title}
      aria-label={title}
      aria-pressed={open}
      onClick={onClick}
    >
      <span className="preview-agent-logo" aria-hidden>
        <img className="logo-light" src={wordmark} alt="" />
        <img className="logo-dark" src={wordmarkDark} alt="" />
      </span>
    </button>
  )
}

export function FileViewer({
  path: initialPath,
  parentConversationId,
  embedded = false,
  agentPanelOpen: agentPanelOpenProp,
  onToggleAgentPanel,
  onPickBlock,
  shellLeading = null
}: {
  path: string
  origin?: 'dock' | 'session'
  parentConversationId?: string | null
  /** Workspace view: no titlebar drag chrome / no nested agent drawer. */
  embedded?: boolean
  /** Workspace split-pane: agent column open (for toolbar toggle). */
  agentPanelOpen?: boolean
  onToggleAgentPanel?: () => void
  /** Workspace Peek: block pick should auto-expand a collapsed Agent panel. */
  onPickBlock?: () => void
  /**
   * Workspace + collapsed sidebar: panel toggle / new session ahead of the
   * file name (traffic lights sit over this column).
   */
  shellLeading?: ReactNode
}): React.JSX.Element {
  const t = useT()
  const [filePath, setFilePath] = useState(initialPath)
  const [info, setInfo] = useState<FileInspectResult | null>(null)
  /** Standalone drawer open state (embedded uses agentPanelOpenProp from parent). */
  const [localAgentOpen, setLocalAgentOpen] = useState(() => {
    // Double-click / open with conversationId → file conversation surface open.
    if (embedded) return false
    try {
      return !!new URLSearchParams(window.location.search).get('conversationId')
    } catch {
      return false
    }
  })
  const agentPanelOpen = embedded ? !!agentPanelOpenProp : localAgentOpen
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
  /** Binary office baseline (base64) for Discard — never treat plainText as the file body. */
  const [baselineBinary, setBaselineBinary] = useState<string | null>(null)
  const [workingContent, setWorkingContent] = useState<string | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  /** Forces OfficeNativeView to re-read disk after an external/agent rewrite. */
  const [previewRevision, setPreviewRevision] = useState(0)
  const [assoc, setAssoc] = useState<FileAssociationStatus | null>(null)
  /** Prevent stacking native sheets if close is re-triggered while one is open. */
  const unsavedPromptOpen = useRef(false)
  /** Blocks picked from mature office/PDF renderers (DOM / sheet). */
  const officeBlocksRef = useRef<Map<string, PreviewBlock>>(new Map())
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
    setInfo(null)
    if (pathChanged) setLocalAgentOpen(false)
    setSelectedIds([])
    setWorkingContent(null)
    setBaselineContent(null)
    setBaselineBinary(null)
    setHasUnsavedChanges(false)
    setPreviewRevision(0)
    unsavedPromptOpen.current = false
    officeBlocksRef.current.clear()
  }, [initialPath])

  const refreshAssoc = useCallback(async (): Promise<void> => {
    const status = await window.vav.settings.fileAssociationForPath(filePathRef.current)
    setAssoc(status)
  }, [])

  useEffect(() => {
    void refreshAssoc()
  }, [filePath, refreshAssoc])

  const reloadInfo = useCallback(async (path: string): Promise<FileInspectResult> => {
    const result = await window.vav.files.inspect(path)
    setInfo(result)
    knownIdentityRef.current = {
      size: result.size,
      mtimeMs: result.mtimeMs ?? 0
    }
    if (result.name && !embedded) document.title = result.name
    return result
  }, [embedded])

  const isBinaryOfficeKind = useCallback((kind: FileInspectResult['kind'] | undefined): boolean => {
    return kind === 'docx' || kind === 'xlsx' || kind === 'pptx' || kind === 'pdf'
  }, [])

  const captureBaseline = useCallback(
    async (path: string, kind: FileInspectResult['kind'] | undefined, text: string | null | undefined) => {
      if (isBinaryOfficeKind(kind)) {
        const bin = await window.vav.files.readBinary(path)
        if (bin.ok) {
          setBaselineBinary(bin.base64)
          setBaselineContent(null)
        }
        return
      }
      setBaselineBinary(null)
      if (text != null) setBaselineContent(text)
    },
    [isBinaryOfficeKind]
  )

  /** Agent/shell rewrote the open file on disk — refresh canvas + mark dirty. */
  const handleExternalFileChange = useCallback(
    async (sourcePath?: string): Promise<void> => {
      if (applyingOwnWrite.current) return
      const current = filePathRef.current
      if (sourcePath && !pathsEqual(sourcePath, current)) return
      const prev = knownIdentityRef.current
      const result = await reloadInfo(current)
      const sameIdentity =
        prev != null &&
        prev.size === result.size &&
        prev.mtimeMs === (result.mtimeMs ?? 0)
      // Text body for text/csv/html; office uses structured plainText only for blocks.
      if (result.kind === 'text' || result.kind === 'csv' || result.kind === 'html') {
        if (result.text != null) setWorkingContent(result.text)
      }
      setHasUnsavedChanges(true)
      // Always bump office canvas when identity moved; also bump when fs-changed
      // named this exact path even if mtime resolution is coarse.
      if (isBinaryOfficeKind(result.kind) && (!sameIdentity || !!sourcePath)) {
        setPreviewRevision((n) => n + 1)
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
        maxBytes: 2 * 1024 * 1024
      })
      if (win.error || state.path !== filePathRef.current) return
      if (hasUnsavedRef.current) return
      if (win.content) {
        setWorkingContent((prev) => (prev ?? '') + win.content)
        setBaselineContent((prev) => (prev ?? '') + win.content)
        setInfo((prev) => {
          if (!prev || prev.path !== state.path) return prev
          const nextText = (prev.text ?? '') + win.content
          return {
            ...prev,
            text: nextText,
            truncated: win.truncated,
            textWindow: {
              startByte: prev.textWindow?.startByte ?? 0,
              endByte: win.endByte,
              totalBytes: win.totalBytes
            },
            lineCount: countNewlinesLocal(nextText)
          }
        })
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
    let cancelled = false
    textWindowFillRef.current = null
    // Mount kind-known canvases immediately while inspect IPC returns.
    // PDF: native stream. ZIP: archive tree (structure filled by inspect).
    // Binary-ish unknown extensions: metadata panel (meta filled by inspect).
    if (/\.pdf$/i.test(filePath)) {
      setInfo((prev) =>
        prev?.path === filePath && prev.kind === 'pdf'
          ? prev
          : {
              path: filePath,
              name: basename(filePath),
              size: prev?.path === filePath ? prev.size : 0,
              kind: 'pdf',
              mime: 'application/pdf'
            }
      )
    } else if (/\.zip$/i.test(filePath)) {
      setInfo((prev) =>
        prev?.path === filePath && prev.kind === 'zip'
          ? prev
          : {
              path: filePath,
              name: basename(filePath),
              size: prev?.path === filePath ? prev.size : 0,
              kind: 'zip',
              mime: 'application/zip',
              zip: {
                entries: [],
                entryCount: 0,
                compressedSize: prev?.path === filePath ? prev.size : 0,
                uncompressedSize: 0,
                ratio: 0
              }
            }
      )
    }
    void reloadInfo(filePath).then(async (result) => {
      if (cancelled) return
      if (result.kind === 'text' || result.kind === 'csv' || result.kind === 'html') {
        if (result.text != null) {
          setWorkingContent(result.text)
          setBaselineContent(result.text)
        }
        setBaselineBinary(null)
        // Silent progressive fill to EOF (no user "load more"). Chunks via idle
        // callback so open stays responsive for multi‑MB logs.
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
        // PDF streams via vav-local; don't block open on a full-file baseline read.
        if (result.kind === 'pdf') {
          setBaselineBinary(null)
        } else {
          await captureBaseline(filePath, result.kind, null)
        }
      } else if (result.text != null) {
        setWorkingContent(result.text)
        setBaselineContent(result.text)
      }
      setHasUnsavedChanges(false)
      // Keep revision if we already painted under the provisional pdf info.
      if (result.kind !== 'pdf') setPreviewRevision(0)
    })
    return () => {
      cancelled = true
    }
  }, [filePath, reloadInfo, isBinaryOfficeKind, captureBaseline, extendTextWindow])

  useEffect(() => {
    try {
      localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth))
    } catch {
      // ignore
    }
  }, [panelWidth])

  useEffect(() => {
    void window.vav.window.setPreviewCloseGuard(hasUnsavedChanges)
  }, [hasUnsavedChanges])

  /**
   * Agent fs_write / Change Review — and any tool that emits fs-changed.
   * Always listen while this file is open (embedded workspace never flips local
   * agentPanelOpen, so gating on that left DOCX edits invisible).
   */
  useEffect(() => {
    return window.vav.agent.onEvent((event) => {
      if (event.type !== 'fs-changed') return
      void handleExternalFileChange(event.filePath)
    })
  }, [handleExternalFileChange])

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
        const probe = await window.vav.files.inspect(filePathRef.current)
        if (
          prev != null &&
          prev.size === probe.size &&
          prev.mtimeMs === (probe.mtimeMs ?? 0)
        ) {
          // Sibling churn only — our open file is unchanged.
          return
        }
        await handleExternalFileChange(filePathRef.current)
      })()
    })
  }, [handleExternalFileChange])

  const displayText = workingContent ?? info?.text ?? ''
  const isMarkdown =
    /\.(md|markdown|mdx)$/i.test(filePath) || (info?.mime ?? '').includes('markdown')
  const isNotebook = /\.ipynb$/i.test(filePath)
  const isCsv = info?.kind === 'csv' || /\.(csv|tsv)$/i.test(filePath)
  const isSqlite = info?.kind === 'sqlite'
  /** FreeMind/Freeplane .mm or OPML mind map (not ObjC++ .mm). */
  const isMindMap =
    (info?.kind === 'text' || info?.kind == null) &&
    (/\.opml$/i.test(filePath) ||
      looksLikeOpml(displayText) ||
      (/\.mm$/i.test(filePath) && looksLikeFreeMind(displayText)))
  const isMermaidFile =
    (info?.kind === 'text' || info?.kind == null) &&
    /\.(mmd|mermaid)$/i.test(filePath)
  const isDotFile =
    (info?.kind === 'text' || info?.kind == null) && /\.(dot|gv)$/i.test(filePath)
  const isDrawioFile =
    (info?.kind === 'text' || info?.kind == null) &&
    (/\.(drawio|dio)$/i.test(filePath) ||
      (/mxfile/i.test(displayText.slice(0, 400)) && /mxGraphModel|mxCell/i.test(displayText)))
  const isDiagramCanvas = isMindMap || isMermaidFile || isDotFile || isDrawioFile
  /** .log and dense line-oriented files: pick individual lines, not paragraphs. */
  const lineOriented =
    !isMarkdown &&
    !isNotebook &&
    !isCsv &&
    !isDiagramCanvas &&
    (info?.kind === 'text' || info?.kind == null) &&
    isLineOrientedPath(filePath, displayText)
  const badge = formatBadge(filePath, info?.kind ?? 'text')
  // Single parse shared by block pick + window sheet (avoids double work on open).
  const csvModel = useMemo(
    () => (isCsv ? parseCsvModel(displayText) : null),
    [isCsv, displayText]
  )

  const isOfficeKind =
    info?.kind === 'pdf' ||
    info?.kind === 'docx' ||
    info?.kind === 'xlsx' ||
    info?.kind === 'pptx'
  const isHtmlKind = info?.kind === 'html'
  const isZip = info?.kind === 'zip'
  /**
   * Reading gutters are per-renderer, not a frame-wide inset.
   *
   * Prose/code want paper margins. Canvas renderers (diagram, sheet, media,
   * office paper, archive tree) own their full box and supply their own insets —
   * a shared frame padding shrank them and pushed centred content off-axis.
   */
  const bodyPad: 'text' | 'none' =
    isDiagramCanvas ||
    isCsv ||
    isSqlite ||
    isOfficeKind ||
    isHtmlKind ||
    isZip ||
    info?.kind === 'image' ||
    info?.kind === 'video' ||
    info?.kind === 'binary'
      ? 'none'
      : 'text'
  const isBinaryUnsupported = info?.kind === 'binary'
  const isDirectoryKind = info?.kind === 'directory'
  const isHeic =
    /\.(heic|heif|hif)$/i.test(filePath) || (info?.mime ?? '').toLowerCase().includes('heic')
  /** Legacy Office extensions (not OOXML). */
  const isLegacyOffice = /\.(doc|ppt|xls)$/i.test(filePath) && !/\.(docx|pptx|xlsx)$/i.test(filePath)
  /**
   * Format-locked read-only → Edit prompts convert + Save As (original untouched).
   * Only for formats we cannot write in-place: HEIC, PDF, legacy .doc/.ppt/.xls.
   * Native OOXML (docx / xlsx / pptx) toggles Edit freely so Agent write tools
   * can target the open path without a bogus “Convert to PPTX” sheet.
   */
  const formatLockedReadOnly =
    isHeic ||
    info?.kind === 'pdf' ||
    /\.pdf$/i.test(filePath) ||
    isLegacyOffice
  /** ZIP / raw binary / directory / draw.io (read-only canvas): cannot enter edit. */
  const hardForcedReadOnly =
    isZip ||
    (isBinaryUnsupported && !isLegacyOffice) ||
    isDirectoryKind ||
    isDrawioFile
  const forcedReadOnly = hardForcedReadOnly || formatLockedReadOnly
  const effectiveReadOnly = readOnly || forcedReadOnly

  // Open locked formats (and soft-default office canvases) as Read.
  // Native OOXML is not locked: user may switch to Edit without convert.
  useEffect(() => {
    if (hardForcedReadOnly || formatLockedReadOnly) {
      if (!readOnly) setReadOnly(true)
      return
    }
  }, [hardForcedReadOnly, formatLockedReadOnly, readOnly])

  // Soft default: native OOXML/PDF canvas opens in Read (pick still works).
  useEffect(() => {
    if (/\.(docx|xlsx|pptx|pdf)$/i.test(filePath)) setReadOnly(true)
  }, [filePath])

  // Keep main-process conversation.fileReadOnly in sync so the agent tool list
  // strips write tools for the entire session (not only after a manual toggle).
  useEffect(() => {
    if (!agentConversationId) return
    if (typeof window.vav.fileSessions?.setReadOnly !== 'function') return
    void window.vav.fileSessions.setReadOnly(agentConversationId, effectiveReadOnly)
  }, [agentConversationId, effectiveReadOnly])

  const syncBlocks = useMemo((): PreviewBlock[] => {
    if (info?.structured?.blocks?.length) return info.structured.blocks
    if (isSqlite && info?.sqlite?.tables?.length) {
      return info.sqlite.tables.map((tb) => ({
        id: `db-table-${tb.name}`,
        kind: 'table' as const,
        text: [
          `TABLE ${tb.name}`,
          `columns: ${tb.columns.join(', ')}`,
          `rows: ${tb.rowCount}`
        ].join('\n'),
        label: `table ${tb.name}`,
        startLine: 1,
        endLine: 1
      }))
    }
    if (isZip && info?.zip?.entries?.length) {
      return info.zip.entries.map((e) => ({
        id: `zip:${e.path}`,
        kind: (e.isDirectory ? 'section' : 'code') as PreviewBlock['kind'],
        text: `${e.isDirectory ? 'DIR' : 'FILE'} ${e.path}`,
        label: `ZIP · ${e.path}`,
        startLine: 1,
        endLine: 1
      }))
    }
    if (info?.text == null && workingContent == null) return []
    // CSV: only col + table stubs (no per-row tree). Sheet body uses the same model.
    if (isCsv) return csvModel?.blocks.filter((b) => b.kind !== 'table') ?? []
    return parseBlocksForPath(filePath, displayText)
  }, [displayText, info, filePath, isCsv, isSqlite, isZip, workingContent, csvModel])

  const rootBlocks = syncBlocks

  const allBlocks = useMemo(() => collectBlocks(rootBlocks), [rootBlocks])

  const mediaSrc = info?.streamUrl || info?.dataUrl || null
  const mediaBlock = useMemo((): PreviewBlock | null => {
    if (!info || !mediaSrc) return null
    return {
      id: 'media',
      kind: 'paragraph',
      text: `${info.kind}: ${filePath}`,
      startLine: 1,
      endLine: 1,
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
   * Block pick for Agent context works in Read and Edit.
   * Read only blocks *writing* the file (tools + Save), not selecting for chat.
   */
  const pickConversationId = agentConversationId ?? parentConversationId ?? null
  const selectable =
    !!info &&
    !info.error &&
    (info.kind === 'text' ||
      info.kind === 'csv' ||
      info.kind === 'sqlite' ||
      info.kind === 'pdf' ||
      info.kind === 'docx' ||
      info.kind === 'xlsx' ||
      info.kind === 'pptx' ||
      info.kind === 'html' ||
      info.kind === 'zip' ||
      !!mediaSrc)

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

      const refId = `${filePath}::${id}`
      const existing = useSessionStore.getState().commentCards[conversationId] ?? []
      // Re-click same block → cancel (spec: 再次单击取消).
      if (existing.some((c) => c.ref.id === refId)) {
        const nextCards = existing.filter((c) => c.ref.id !== refId)
        useSessionStore.getState().setCommentCards(conversationId, nextCards)
        const prefix = `${filePath}::`
        setSelectedIds(
          nextCards
            .filter((c) => c.ref.id.startsWith(prefix))
            .map((c) => c.ref.id.slice(prefix.length))
        )
        return
      }
      // Drop empty-comment cards for other blocks; add the new pick.
      const cleaned = existing.filter((c) => c.comment.trim())
      const ref = blockToRef(filePath, badge, block)
      const nextCards = [...cleaned, { ref, comment: '' }]
      useSessionStore.getState().setCommentCards(conversationId, nextCards)
      const prefix = `${filePath}::`
      // Paint canvas selection first; focus/panel open reflows preview (PPTX
      // windowed remount) and used to feel like click → blur → second click.
      setSelectedIds(
        nextCards
          .filter((c) => c.ref.id.startsWith(prefix))
          .map((c) => c.ref.id.slice(prefix.length))
      )
      // CLI agents: selection (+ optional vav draft) into the prompt — no submit.
      void import('../lib/cliFocusHandoff').then(({ handoffBlockToCli }) => {
        handoffBlockToCli(conversationId, ref)
      })
      // Open agent column + focus comment *after* paint; skip if another pick
      // gesture already started (focus thrash between canvas and comment).
      requestAnimationFrame(() => {
        if (isPickGestureActive()) return
        if (!embedded) setLocalAgentOpen(true)
        onPickBlock?.()
        requestAnimationFrame(() => {
          if (isPickGestureActive()) return
          useSessionStore.getState().focusCommentCard(refId)
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
    const hit = blockAtLine(rootBlocks, line)
    if (hit) applySelection(hit.id, event)
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
    // 1) FileSessionStore (preferred — multi-session, hidden from sidebar)
    try {
      if (typeof window.vav.fileSessions?.open === 'function') {
        const state = await window.vav.fileSessions.open(filePath)
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
    await createConversation({ workingDirectory: dirname(filePath) })
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
    const groupId = store.activeGroupId
    const underWorkspaceView =
      !!groupId &&
      !groupId.startsWith('__') &&
      (path === groupId ||
        path.startsWith(`${groupId}/`) ||
        path.startsWith(`${groupId}\\`))

    if (underWorkspaceView) {
      useWorkspaceStore.getState().selectPath(conversationId, path)
      return
    }

    const meta = store.conversations.find((c) => c.id === conversationId)
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

  // Standalone: restore file session as soon as the window is ready.
  useEffect(() => {
    if (embedded) return
    void ensureFileSession()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, filePath])

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
      if (hasUnsavedChanges) {
        await promptUnsaved('done')
        return
      }
      closeAgentPanel()
      return
    }

    // Snapshot the pre-agent body so Discard can restore (binary or text).
    if (isBinaryOfficeKind(info?.kind)) {
      await captureBaseline(filePath, info?.kind, null)
      setWorkingContent(null)
    } else {
      const text = info?.text ?? workingContent ?? ''
      setBaselineContent(text)
      setWorkingContent(text)
      setBaselineBinary(null)
    }
    setHasUnsavedChanges(false)
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
    try {
      if (typeof window.vav.fileSessions?.create === 'function') {
        const state = await window.vav.fileSessions.create(filePath)
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
      await createConversation({ workingDirectory: dirname(filePath) })
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
  const convertEditProfile = useMemo((): {
    formatKey: 'jpeg' | 'docx' | 'xlsx' | 'pptx' | 'pdf'
    suggestedPath: string
    sourcePath: string
  } | null => {
    if (isHeic) {
      return {
        formatKey: 'jpeg',
        suggestedPath: replaceExt(filePath, '.jpg'),
        sourcePath: info?.contentPath?.trim() || filePath
      }
    }
    if (info?.kind === 'docx' || (/\.docx$/i.test(filePath) && !isLegacyOffice)) {
      return {
        formatKey: 'docx',
        suggestedPath: replaceExt(filePath, '.docx'),
        sourcePath: info?.contentPath?.trim() || filePath
      }
    }
    if (info?.kind === 'xlsx' || /\.xlsx$/i.test(filePath)) {
      return {
        formatKey: 'xlsx',
        suggestedPath: replaceExt(filePath, '.xlsx'),
        sourcePath: info?.contentPath?.trim() || filePath
      }
    }
    if (info?.kind === 'pptx' || /\.pptx$/i.test(filePath)) {
      return {
        formatKey: 'pptx',
        suggestedPath: replaceExt(filePath, '.pptx'),
        sourcePath: info?.contentPath?.trim() || filePath
      }
    }
    if (info?.kind === 'pdf' || /\.pdf$/i.test(filePath)) {
      return {
        formatKey: 'pdf',
        suggestedPath: replaceExt(filePath, '.pdf'),
        sourcePath: filePath
      }
    }
    // Legacy .doc → converted sidecar is usually DOCX/HTML temp; prefer DOCX name.
    if (/\.doc$/i.test(filePath) && !/\.docx$/i.test(filePath)) {
      return {
        formatKey: 'docx',
        suggestedPath: replaceExt(filePath, '.docx'),
        sourcePath: info?.contentPath?.trim() || filePath
      }
    }
    if (/\.xls$/i.test(filePath) && !/\.xlsx$/i.test(filePath)) {
      return {
        formatKey: 'xlsx',
        suggestedPath: replaceExt(filePath, '.xlsx'),
        sourcePath: info?.contentPath?.trim() || filePath
      }
    }
    if (/\.ppt$/i.test(filePath) && !/\.pptx$/i.test(filePath)) {
      return {
        formatKey: 'pptx',
        suggestedPath: replaceExt(filePath, '.pptx'),
        sourcePath: info?.contentPath?.trim() || filePath
      }
    }
    return null
  }, [filePath, info?.contentPath, info?.kind, isHeic, isLegacyOffice])

  const convertAndSaveAs = async (): Promise<boolean> => {
    const profile = convertEditProfile
    if (!profile) return false
    applyingOwnWrite.current = true
    try {
      const bin = await window.vav.files.readBinary(profile.sourcePath)
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

  const save = async (): Promise<boolean> => {
    applyingOwnWrite.current = true
    try {
      if (isBinaryOfficeKind(info?.kind)) {
        // Agent/shell already wrote the binary on disk — Save means accept.
        await captureBaseline(filePath, info?.kind, null)
        setHasUnsavedChanges(false)
        await reloadInfo(filePath)
        showToast({ kind: 'success', title: t('preview.saved') })
        return true
      }
      const content = workingContent ?? info?.text ?? ''
      const result = await window.vav.files.write(filePath, content)
      if (!result.ok) {
        showToast({
          kind: 'error',
          title: t('preview.saveFailed'),
          description: result.error
        })
        return false
      }
      setBaselineContent(content)
      setHasUnsavedChanges(false)
      await reloadInfo(filePath)
      showToast({ kind: 'success', title: t('preview.saved') })
      return true
    } finally {
      // Defer so filesystem watchers from our own write don't re-dirty.
      window.setTimeout(() => {
        applyingOwnWrite.current = false
      }, 400)
    }
  }

  const saveAs = async (): Promise<boolean> => {
    if (isBinaryOfficeKind(info?.kind)) {
      // Copy current on-disk bytes to a new path (Save As for office).
      applyingOwnWrite.current = true
      try {
        const bin = await window.vav.files.readBinary(filePath)
        if (!bin.ok) {
          showToast({
            kind: 'error',
            title: t('preview.saveFailed'),
            description: bin.error
          })
          return false
        }
        const originalPath = filePath
        // Reuse text saveAs dialog, then overwrite with binary bytes.
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
        const written = await window.vav.files.writeBinary(result.path, bin.base64)
        if (!written.ok) {
          showToast({
            kind: 'error',
            title: t('preview.saveFailed'),
            description: written.error
          })
          return false
        }
        // Spec: original stays at the pre-edit snapshot when possible.
        if (baselineBinary != null && result.path !== originalPath) {
          await window.vav.files.writeBinary(originalPath, baselineBinary)
        }
        setFilePath(result.path)
        setBaselineBinary(bin.base64)
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
      // Spec: original file stays at the edit-entry snapshot.
      if (baselineContent != null && result.path !== originalPath) {
        await window.vav.files.write(originalPath, baselineContent)
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

  const discard = async (): Promise<void> => {
    applyingOwnWrite.current = true
    try {
      if (isBinaryOfficeKind(info?.kind)) {
        if (baselineBinary != null) {
          const result = await window.vav.files.writeBinary(filePath, baselineBinary)
          if (!result.ok) {
            showToast({
              kind: 'error',
              title: t('preview.saveFailed'),
              description: result.error
            })
            return
          }
          await reloadInfo(filePath)
          setPreviewRevision((n) => n + 1)
        }
        setHasUnsavedChanges(false)
        return
      }
      if (baselineContent != null) {
        await window.vav.files.write(filePath, baselineContent)
        setWorkingContent(baselineContent)
        await reloadInfo(filePath)
      }
      setHasUnsavedChanges(false)
    } finally {
      window.setTimeout(() => {
        applyingOwnWrite.current = false
      }, 400)
    }
  }

  /**
   * Native Save / Cancel / Discard sheet (macOS: buttons[0] is rightmost primary).
   * Used for window close and for folding the agent panel with dirty buffer.
   */
  const promptUnsaved = useCallback(
    async (intent: UnsavedIntent): Promise<void> => {
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
          if (intent === 'close') {
            void window.vav.window.forcePreviewClose()
            return
          }
          closeAgentPanel()
          return
        }
        if (response === 2) {
          await discard()
          if (intent === 'close') {
            void window.vav.window.setPreviewCloseGuard(false)
            void window.vav.window.forcePreviewClose()
            return
          }
          closeAgentPanel()
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
    if (info.lineCount != null) parts.push(t('files.lines', { n: info.lineCount }))
    parts.push(badge)
    parts.push(filePath)
    // Never surface technical windowing as "truncated" in the status strip.
    if (hasUnsavedChanges) parts.push('•')
    return parts.join(' · ')
  }, [info, badge, filePath, t, hasUnsavedChanges])

  const statusRight = useMemo(() => {
    if (isBinaryUnsupported) return ''
    if (selectedBlocks.length === 0) return ''
    if (isZip) {
      return t('preview.entriesSelected', { n: selectedBlocks.length })
    }
    const first = selectedBlocks[0]
    if (selectedBlocks.length === 1 && first?.label) return first.label
    if (selectedBlocks.length === 1 && first) {
      return t('preview.blocksSelectedLines', {
        n: 1,
        start: first.startLine,
        end: first.endLine
      })
    }
    return t('preview.blocksSelected', { n: selectedBlocks.length })
  }, [selectedBlocks, t, isBinaryUnsupported, isZip])

  const agentToggle = (
    <AgentPanelToggleButton
      open={agentPanelOpen}
      title={embedded ? t('workspace.toggleAgentPanel') : t('preview.agentPanel')}
      onClick={() => {
        if (embedded && onToggleAgentPanel) {
          onToggleAgentPanel()
          return
        }
        void toggleAgentPanel()
      }}
      className={embedded ? undefined : 'titlebar-no-drag'}
    />
  )

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
            title={filePath}
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
                    onSelect?: () => void
                  }[] = [
                    {
                      label: `${t('preview.saveAs')} (⌘⇧S)`,
                      onSelect: () => void saveAs()
                    }
                  ]
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
                  const next = Math.min(520, Math.max(280, startW + (startX - e.clientX)))
                  panelWidthRef.current = next
                  setPanelWidth(next)
                }
                const onUp = (): void => {
                  window.removeEventListener('mousemove', onMove)
                  window.removeEventListener('mouseup', onUp)
                  try {
                    localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidthRef.current))
                  } catch {
                    // ignore
                  }
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
                    <SessionDetail variant="preview-edit" fileSessionChrome={fileChrome} />
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
              <MediaSelectFrame
                selecting={selectable}
                selected={selectedIds.includes('media')}
                onSelect={(event) => applySelection('media', event)}
              >
                <div className="file-viewer-media-stack">
                  <img
                    className="file-viewer-media"
                    src={mediaSrc}
                    alt={info.name}
                    draggable={false}
                  />
                </div>
              </MediaSelectFrame>
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
            !mediaSrc && (
              <BinaryFileView
                info={info}
                meta={info.binaryMeta ?? null}
                onOpenWithDefault={() => void window.vav.files.openWithDefault(filePath)}
                onReveal={() => void window.vav.conversations.revealInFinder(filePath)}
              />
            )}
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
            <OfficeNativeView
              path={info.contentPath || filePath}
              kind={info.kind}
              revision={previewRevision}
              selecting={selectable}
              selectedIds={selectedIds}
              onPick={onOfficePick}
            />
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
          {info && info.kind === 'binary' && (
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
          )}
          </>
          </Suspense>
  )

  const statusFooter = (
      <footer className="file-preview-statusbar">
        <span className="file-preview-status-left" title={statusLeft}>
          {statusLeft}
        </span>
        {statusRight ? (
          <span className="file-preview-status-right" title={statusRight}>
            {statusRight}
          </span>
        ) : null}
      </footer>
  )

  const fileColumn = (
    <>
      {fileHeader}
      <div className="file-preview-main">
        <div
          className={`file-viewer-body${selectable ? ' selecting pick-mode' : ''}`}
          data-pad={bodyPad}
          onClickCapture={(event) => {
            // Markdown / office / HTML previews: never follow hyperlinks.
            suppressHyperlinkClick(event)
          }}
        >
          {fileBody}
        </div>
      </div>
      {statusFooter}
    </>
  )

  return (
    <div
      className={`file-preview-shell${agentPanelOpen && !embedded ? ' agent-open' : ''}${embedded ? ' embedded' : ''}`}
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

function countNewlinesLocal(text: string): number {
  if (!text) return 0
  let n = 1
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) n++
  }
  if (text.charCodeAt(text.length - 1) === 10) n--
  return Math.max(n, 1)
}

function collectBlocks(blocks: PreviewBlock[]): PreviewBlock[] {
  const out: PreviewBlock[] = []
  const walk = (list: PreviewBlock[]): void => {
    for (const b of list) {
      out.push(b)
      if (b.children) walk(b.children)
    }
  }
  walk(blocks)
  return out
}

/** Path compare for fs-changed / dirty events (macOS is usually case-insensitive). */
function pathsEqual(a: string, b: string): boolean {
  if (a === b) return true
  const na = a.replace(/\/+$/, '')
  const nb = b.replace(/\/+$/, '')
  if (na === nb) return true
  return na.toLowerCase() === nb.toLowerCase()
}

/** One selected preview block → a composer comment-block reference. */
function blockToRef(path: string, badge: string, block: PreviewBlock): PreviewRef {
  return {
    id: `${path}::${block.id}`,
    filePath: path,
    // Chip title: "list-item · line 45" (matches comment-card mock).
    label: formatCommentCardLabel(block),
    startLine: block.startLine,
    endLine: block.endLine,
    text: block.text,
    badge
  }
}

/** Human title for the comment card header (kind · line N). */
function formatCommentCardLabel(block: PreviewBlock): string {
  // Log / line-oriented picks: never say "paragraph".
  if (block.kind === 'line' || block.id.startsWith('line-L')) {
    return `line ${block.startLine}`
  }
  const kind = (block.kind || 'block').replace(/_/g, '-')
  if (block.startLine === block.endLine) return `${kind} · line ${block.startLine}`
  return `${kind} · lines ${block.startLine}–${block.endLine}`
}

/**
 * Centers media in the preview stage.
 *
 * Pick outline is a wrapper around media — never cloneElement onto <audio>/
 * <video>. Assigning pick classes (display:flex) onto native controls collapsed
 * the player to an empty stage (MP3 looked blank).
 */
function MediaSelectFrame({
  selecting,
  selected,
  onSelect,
  children
}: {
  selecting: boolean
  selected: boolean
  onSelect: (event?: React.MouseEvent | ClickPickPointer | null) => void
  children: React.ReactNode
}): React.JSX.Element {
  if (!selecting) {
    return <div className="preview-media-stage">{children}</div>
  }
  return (
    <div className="preview-media-stage">
      <div
        className={`preview-select-region media-pick-frame${selected ? ' selected' : ''}`}
        onMouseDown={(event) => {
          // Native seek/play/volume must work — don't steal those clicks.
          const tag = (event.target as HTMLElement | null)?.tagName
          if (tag === 'AUDIO' || tag === 'VIDEO') return
          handleClickPickMouseDown(event, () => onSelect(null))
        }}
      >
        {children}
      </div>
    </div>
  )
}

/**
 * Same rendered document in preview and edit. Edit only enables inspect-style
 * block selection — never a source/code editor or inline cell inputs.
 */
function DocumentView({
  path,
  text,
  markdown,
  notebook,
  lineOriented = false,
  selecting,
  blocks,
  selectedIds,
  selectedBlocks,
  onSelectBlock,
  onSelectLine,
  onNearEnd,
  onAskAgent
}: {
  path: string
  text: string
  markdown: boolean
  notebook: boolean
  /** Per-line pick (logs) — no paragraph block tree required. */
  lineOriented?: boolean
  selecting: boolean
  blocks: PreviewBlock[]
  selectedIds: string[]
  selectedBlocks: PreviewBlock[]
  onSelectBlock: (id: string, event?: React.MouseEvent | ClickPickPointer | null) => void
  onSelectLine: (line: number, event?: React.MouseEvent | ClickPickPointer | null) => void
  /** Silent windowed fill when the user scrolls near loaded end. */
  onNearEnd?: () => void
  onAskAgent: (prompt: string, target: PreviewBlock) => void
}): React.JSX.Element {
  const t = useT()

  if (markdown) {
    if (blocks.length === 0) {
      if (!text.trim()) {
        return (
          <EmptyState title={t('preview.emptyFile')} description={t('preview.emptyFileDesc')} />
        )
      }
      return (
        <div className={`preview-document${selecting ? ' selecting' : ''}`}>
          <MarkdownView source={text} filePath={path} />
        </div>
      )
    }
    return (
      <div className={`preview-document${selecting ? ' selecting' : ''}`}>
        {blocks.map((block) => (
          <MarkdownSelectRegion
            key={block.id}
            filePath={path}
            block={block}
            selecting={selecting}
            selectedIds={selectedIds}
            onSelect={onSelectBlock}
            onAskAgent={onAskAgent}
          />
        ))}
      </div>
    )
  }

  if (notebook) {
    const cells = parseNotebookBlocks(text)
    if (cells.length === 0) {
      return (
        <EmptyState title={t('preview.emptyFile')} description={t('preview.emptyFileDesc')} />
      )
    }
    return (
      <div className={`preview-document notebook${selecting ? ' selecting' : ''}`}>
        {cells.map((cell) => {
          const selected = selecting && selectedIds.includes(cell.id)
          const body = !cell.language ? (
            <MarkdownView source={cell.text} filePath={path} />
          ) : (
            <pre className="file-viewer-code">
              <code
                className="hljs"
                dangerouslySetInnerHTML={{
                  __html: highlightCode(cell.text, cell.language || 'python')
                }}
              />
            </pre>
          )
          if (!selecting) {
            return (
              <div key={cell.id} className="preview-notebook-cell">
                {body}
              </div>
            )
          }
          return (
            <div
              key={cell.id}
              className={`preview-notebook-cell preview-select-region${selected ? ' selected' : ''}`}
              onMouseDown={(event) =>
                handleClickPickMouseDown(event, () => onSelectBlock(cell.id, null))
              }
              onContextMenu={(event) => {
                event.preventDefault()
                void window.vav.window
                  .popupMenu(
                    [
                      { id: 'copy', label: t('preview.copyBlock') },
                      { id: 'analyze', label: t('preview.analyzeBlock') },
                      { id: 'refactor', label: t('preview.refactorBlock') }
                    ],
                    { x: event.clientX, y: event.clientY }
                  )
                  .then((id) => {
                    if (id === 'copy') void window.vav.conversations.copyToClipboard(cell.text)
                    if (id === 'analyze') onAskAgent(t('preview.analyzePrompt'), cell)
                    if (id === 'refactor') onAskAgent(t('preview.refactorPrompt'), cell)
                  })
              }}
            >
              {body}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <CodeBlockCanvas
      path={path}
      text={text}
      lineOriented={lineOriented}
      selecting={selecting}
      blocks={blocks}
      selectedIds={selectedIds}
      selectedBlocks={selectedBlocks}
      onSelectBlock={onSelectBlock}
      onSelectLine={onSelectLine}
      onNearEnd={onNearEnd}
      onAskAgent={onAskAgent}
    />
  )
}

/**
 * Continuous highlighted source with whole-block outlines (not per-line paint).
 *
 * Viewport virtualization: only the visible window (+ overscan) is highlighted
 * and mounted as DOM. Full-file highlight of large XML/JSON was freezing open.
 * Selection overlays still use absolute line ranges against the virtual height.
 */
const CODE_OVERSCAN_LINES = 48
/** Below this line count, render everything (small files stay simple). */
const CODE_VIRTUALIZE_MIN_LINES = 200

function CodeBlockCanvas({
  path,
  text,
  lineOriented = false,
  selecting,
  blocks,
  selectedIds,
  selectedBlocks,
  onSelectBlock,
  onSelectLine,
  onNearEnd,
  onAskAgent
}: {
  path: string
  text: string
  lineOriented?: boolean
  selecting: boolean
  blocks: PreviewBlock[]
  selectedIds: string[]
  selectedBlocks: PreviewBlock[]
  onSelectBlock: (id: string, event?: React.MouseEvent | ClickPickPointer | null) => void
  onSelectLine: (line: number, event?: React.MouseEvent | ClickPickPointer | null) => void
  onNearEnd?: () => void
  onAskAgent: (prompt: string, target: PreviewBlock) => void
}): React.JSX.Element {
  const t = useT()
  const language = languageFromPath(path)
  const lines = useMemo(() => text.split(/\r?\n/), [text])
  const virtualize = lines.length >= CODE_VIRTUALIZE_MIN_LINES
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const containerRef = useRef<HTMLPreElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const [linePx, setLinePx] = useState(0)
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 600 })
  const [contentMinWidth, setContentMinWidth] = useState(0)
  /** Overlay width in px = max content width of lines in the block range. */
  const [overlayWidths, setOverlayWidths] = useState<Record<string, number>>({})
  const scrollRaf = useRef(0)
  const onNearEndRef = useRef(onNearEnd)
  onNearEndRef.current = onNearEnd

  // Measure line-height from a real line box (must match CSS --code-line-height).
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const probe = el.querySelector<HTMLElement>('.preview-code-line')
    if (probe) {
      const h = probe.getBoundingClientRect().height
      if (h > 0) {
        setLinePx(h)
        return
      }
    }
    const cs = getComputedStyle(el)
    const fontSize = parseFloat(cs.fontSize) || 12
    const lh = parseFloat(cs.lineHeight)
    setLinePx(Number.isFinite(lh) && lh > 0 ? lh : fontSize * 1.55)
  }, [text, language, virtualize])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const sync = (): void => {
      if (scrollRaf.current) return
      scrollRaf.current = requestAnimationFrame(() => {
        scrollRaf.current = 0
        // Read from the scrolling element only — body must not scroll instead.
        const scrollTop = el.scrollTop
        const height = el.clientHeight || 600
        setViewport({ scrollTop, height })
        // Seamless window fill: near the bottom of *loaded* content, pull more.
        const room = el.scrollHeight - scrollTop - height
        if (room < Math.max(320, height * 0.6)) {
          onNearEndRef.current?.()
        }
      })
    }
    sync()
    el.addEventListener('scroll', sync, { passive: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : null
    ro?.observe(el)
    return () => {
      el.removeEventListener('scroll', sync)
      ro?.disconnect()
      if (scrollRaf.current) cancelAnimationFrame(scrollRaf.current)
    }
  }, [lines.length, virtualize])

  const lh = linePx > 0 ? linePx : 19
  const range = useMemo(() => {
    if (!virtualize) return { start: 0, end: lines.length }
    const start = Math.max(0, Math.floor(viewport.scrollTop / lh) - CODE_OVERSCAN_LINES)
    const visible = Math.ceil(Math.max(viewport.height, 1) / lh) + CODE_OVERSCAN_LINES * 2
    const end = Math.min(lines.length, start + Math.max(visible, 60))
    return { start, end }
  }, [virtualize, viewport.scrollTop, viewport.height, lh, lines.length])

  // Highlight only the visible window — never the whole file.
  const visibleHtml = useMemo(() => {
    const out: string[] = []
    for (let i = range.start; i < range.end; i++) {
      out.push(highlightCode(lines[i] ?? '', language) || ' ')
    }
    return out
  }, [lines, range.start, range.end, language])

  const hoverBlock = useMemo((): PreviewBlock | null => {
    if (!selecting || !hoveredId || selectedIds.includes(hoveredId)) return null
    if (lineOriented && hoveredId.startsWith('line-L')) {
      const line = Number(hoveredId.slice('line-L'.length))
      if (!Number.isFinite(line) || line < 1 || line > lines.length) return null
      return {
        id: hoveredId,
        kind: 'line',
        text: lines[line - 1] ?? '',
        startLine: line,
        endLine: line,
        label: `L${line}`
      }
    }
    return findBlockById(blocks, hoveredId)
  }, [selecting, hoveredId, selectedIds, lineOriented, lines, blocks])

  /**
   * Absolute overlays for structured/code blocks. Line-oriented logs paint
   * selection on the row DOM itself (avoids ghost boxes in empty flex space).
   */
  const overlays = useMemo(() => {
    if (!selecting || lineOriented) return []
    const result: {
      id: string
      startLine: number
      endLine: number
      selected: boolean
      hovered: boolean
    }[] = []
    for (const block of selectedBlocks) {
      result.push({
        id: block.id,
        startLine: block.startLine,
        endLine: block.endLine,
        selected: true,
        hovered: false
      })
    }
    if (hoverBlock) {
      result.push({
        id: hoverBlock.id,
        startLine: hoverBlock.startLine,
        endLine: hoverBlock.endLine,
        selected: false,
        hovered: true
      })
    }
    return result
  }, [selecting, lineOriented, selectedBlocks, hoverBlock])

  // Measure visible line widths for horizontal scroll + tight selection boxes.
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const lineEls = canvas.querySelectorAll<HTMLElement>('.preview-code-line')
    let maxW = 0
    lineEls.forEach((lineEl) => {
      const content = (lineEl.firstElementChild as HTMLElement | null) ?? lineEl
      maxW = Math.max(maxW, content.offsetWidth, content.scrollWidth)
    })
    if (maxW > 0) {
      setContentMinWidth((prev) => (maxW > prev ? maxW : prev))
    }

    if (!selecting || overlays.length === 0) {
      setOverlayWidths((prev) => (Object.keys(prev).length === 0 ? prev : {}))
      return
    }
    const next: Record<string, number> = {}
    for (const ov of overlays) {
      // Only measure intersection with the mounted window.
      const from = Math.max(ov.startLine - 1, range.start)
      const to = Math.min(ov.endLine, range.end)
      let max = 0
      for (let i = from; i < to; i++) {
        const lineEl = lineEls[i - range.start]
        if (!lineEl) continue
        const content = (lineEl.firstElementChild as HTMLElement | null) ?? lineEl
        max = Math.max(max, content.offsetWidth, content.scrollWidth)
      }
      next[ov.id] = Math.max(max, overlayWidths[ov.id] ?? 0, 8)
    }
    setOverlayWidths((prev) => {
      const keys = Object.keys(next)
      if (
        keys.length === Object.keys(prev).length &&
        keys.every((k) => prev[k] === next[k])
      ) {
        return prev
      }
      return { ...prev, ...next }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- overlayWidths read is a floor, not a dep
  }, [selecting, overlays, visibleHtml, range.start, range.end])

  /** Map pointer → line; null when outside real content (not empty flex padding). */
  const lineAtPointer = (event: React.MouseEvent): number | null => {
    const el = containerRef.current
    if (!el || lines.length <= 0) return null
    const rect = el.getBoundingClientRect()
    const y = event.clientY - rect.top + el.scrollTop
    const contentH = lines.length * lh
    // Clicks in leftover flex/empty area below the last line must not pick.
    if (y < 0 || y >= contentH) return null
    const lineNo = Math.floor(y / lh) + 1
    if (lineNo < 1 || lineNo > lines.length) return null
    return lineNo
  }

  const handleMouseMove = (event: React.MouseEvent): void => {
    if (!selecting) return
    const lineNo = lineAtPointer(event)
    if (lineNo == null) {
      setHoveredId(null)
      return
    }
    if (lineOriented) {
      setHoveredId(`line-L${lineNo}`)
      return
    }
    const hit = blockAtLine(blocks, lineNo)
    setHoveredId(hit?.id ?? null)
  }

  const handlePointerPick = (event: React.MouseEvent): void => {
    if (!selecting) return
    // Capture line under pointer at mousedown — drag may move the cursor.
    const lineNo = lineAtPointer(event)
    if (lineNo == null) return
    // Skip pure-empty rows in log mode — they produced ghost 8px boxes.
    if (lineOriented && !(lines[lineNo - 1] ?? '').trim()) return
    handleClickPickMouseDown(event, () => onSelectLine(lineNo, null), {
      stopPropagation: false
    })
  }

  const handleContextMenu = (event: React.MouseEvent): void => {
    if (!selecting) return
    event.preventDefault()
    const lineNo = lineAtPointer(event)
    if (lineNo == null) return
    if (lineOriented && !(lines[lineNo - 1] ?? '').trim()) return
    const hit = lineOriented
      ? ({
          id: `line-L${lineNo}`,
          kind: 'line' as const,
          text: lines[lineNo - 1] ?? '',
          startLine: lineNo,
          endLine: lineNo,
          label: `L${lineNo}`
        } satisfies PreviewBlock)
      : blockAtLine(blocks, lineNo)
    if (!hit) return
    const parent = lineOriented ? null : parentBlockOf(blocks, hit.id)
    void window.vav.window
      .popupMenu(
        [
          { id: 'copy', label: t('preview.copyBlock') },
          { id: 'analyze', label: t('preview.analyzeBlock') },
          { id: 'refactor', label: t('preview.refactorBlock') },
          ...(parent ? [{ id: 'parent', label: t('preview.selectParent') }] : [])
        ],
        { x: event.clientX, y: event.clientY }
      )
      .then((id) => {
        if (id === 'copy') void window.vav.conversations.copyToClipboard(hit.text)
        if (id === 'analyze') onAskAgent(t('preview.analyzePrompt'), hit)
        if (id === 'refactor') onAskAgent(t('preview.refactorPrompt'), hit)
        if (id === 'parent' && parent) onSelectBlock(parent.id, event)
      })
  }

  const totalHeight = Math.max(lh, lines.length * lh)
  const padTop = range.start * lh
  const padBottom = Math.max(0, (lines.length - range.end) * lh)

  return (
    <pre
      ref={containerRef}
      className={`file-viewer-code continuous${selecting ? ' selecting' : ''}${
        virtualize ? ' is-virtualized' : ''
      }`}
      onMouseMove={selecting ? handleMouseMove : undefined}
      onMouseLeave={() => setHoveredId(null)}
      onMouseDown={selecting ? handlePointerPick : undefined}
      onContextMenu={selecting ? handleContextMenu : undefined}
    >
      <div
        className="preview-code-canvas"
        ref={canvasRef}
        style={{
          // Prefer padding spacers over a single absolute window + fixed height
          // so scrollHeight always matches line count × line height.
          minHeight: virtualize ? totalHeight : undefined,
          height: virtualize ? totalHeight : undefined,
          minWidth: contentMinWidth > 0 ? contentMinWidth : undefined,
          position: 'relative'
        }}
      >
        <div
          className="preview-code-window"
          style={
            virtualize
              ? {
                  position: 'absolute',
                  top: padTop,
                  left: 0,
                  minWidth: '100%',
                  // Bottom spacer via canvas height; window only hosts visible lines.
                  paddingBottom: 0
                }
              : { minWidth: '100%' }
          }
        >
          {visibleHtml.map((html, i) => {
            const lineNo = range.start + i + 1
            const lineId = `line-L${lineNo}`
            const rowSelected =
              lineOriented && selecting && selectedIds.includes(lineId)
            const rowHovered =
              lineOriented && selecting && hoveredId === lineId && !rowSelected
            return (
              <div
                className={[
                  'preview-code-line',
                  rowSelected ? 'is-selected' : '',
                  rowHovered ? 'is-hovered' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
                key={lineNo}
                data-line={lineNo}
              >
                <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
              </div>
            )
          })}
        </div>
        {/* Invisible bottom sentinel keeps total scroll extent stable if height math drifts. */}
        {virtualize && padBottom > 0 ? (
          <div aria-hidden style={{ position: 'absolute', top: totalHeight - 1, height: 1, width: 1 }} />
        ) : null}
        {/* Structured/code block overlays only — logs use row .is-selected. */}
        {overlays.map((ov) => (
          <div
            key={`ov-${ov.id}`}
            className={`preview-code-overlay${ov.selected ? ' selected' : ''}${ov.hovered ? ' hovered' : ''}`}
            style={{
              top: (ov.startLine - 1) * lh,
              height: Math.max(lh, (ov.endLine - ov.startLine + 1) * lh),
              width: overlayWidths[ov.id] != null ? `${overlayWidths[ov.id]}px` : undefined
            }}
          />
        ))}
      </div>
    </pre>
  )
}

/**
 * Markdown pick targets — same semantics as CodeBlockCanvas:
 * click deepest region, selection outline stays while the block is picked,
 * nested children are independently selectable (no double-click drill).
 */
function MarkdownSelectRegion({
  filePath,
  block,
  selecting,
  selectedIds,
  onSelect,
  onAskAgent,
  forceSelected = false
}: {
  filePath: string
  block: PreviewBlock
  selecting: boolean
  selectedIds: string[]
  onSelect: (id: string, event?: React.MouseEvent | ClickPickPointer | null) => void
  onAskAgent: (prompt: string, target: PreviewBlock) => void
  forceSelected?: boolean
}): React.JSX.Element {
  const t = useT()
  const children = block.children ?? []
  const section = children.find((c) => c.kind === 'heading-section')
  const nested = children.filter((c) => c.kind !== 'heading-section')
  const sectionSelected = selecting && !!section && selectedIds.includes(section.id)
  const selected =
    selecting && (forceSelected || selectedIds.includes(block.id) || sectionSelected)
  const childForce = forceSelected || sectionSelected

  const renderNested = (): React.ReactNode =>
    nested.map((child) => (
      <MarkdownSelectRegion
        key={child.id}
        filePath={filePath}
        block={child}
        selecting={selecting}
        selectedIds={selectedIds}
        onSelect={onSelect}
        onAskAgent={onAskAgent}
        forceSelected={childForce}
      />
    ))

  // Prefer nested hit targets when children cover content (lists, etc.) so
  // granularity matches code's deepest-block pick. Headings still show the
  // heading line plus nested body blocks.
  let body: React.ReactNode
  if (block.kind === 'code') {
    body = (
      <pre className="file-viewer-code">
        <code
          className="hljs"
          dangerouslySetInnerHTML={{
            __html: highlightCode(
              block.text.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, ''),
              block.language
            )
          }}
        />
      </pre>
    )
  } else if (block.kind === 'heading') {
    body = (
      <>
        <MarkdownView source={block.text} filePath={filePath} />
        {renderNested()}
      </>
    )
  } else if (nested.length > 0) {
    body = renderNested()
  } else {
    body = <MarkdownView source={block.text} filePath={filePath} />
  }

  return (
    <div
      className={`preview-select-region kind-${block.kind}${selected ? ' selected' : ''}`}
      onMouseDown={
        selecting
          ? (event) =>
              handleClickPickMouseDown(event, () => onSelect(block.id, null))
          : undefined
      }
      onContextMenu={
        selecting
          ? (event) => {
              event.preventDefault()
              event.stopPropagation()
              const items = [
                { id: 'copy', label: t('preview.copyBlock') },
                ...(section ? [{ id: 'section', label: t('preview.selectSection') }] : []),
                { id: 'analyze', label: t('preview.analyzeBlock') },
                { id: 'refactor', label: t('preview.refactorBlock') }
              ]
              void window.vav.window
                .popupMenu(items, { x: event.clientX, y: event.clientY })
                .then((id) => {
                  const target = id === 'section' && section ? section : block
                  if (id === 'copy') void window.vav.conversations.copyToClipboard(target.text)
                  if (id === 'section' && section) onSelect(section.id, event)
                  if (id === 'analyze') onAskAgent(t('preview.analyzePrompt'), target)
                  if (id === 'refactor') onAskAgent(t('preview.refactorPrompt'), target)
                })
            }
          : undefined
      }
    >
      {body}
    </div>
  )
}

/** Rows rendered at once — full DOM for huge CSVs freezes/crashes Electron. */
const CSV_WINDOW = 80
/** Columns painted at once; wide sheets page horizontally. */
const CSV_COL_WINDOW = 32
/** Truncate cell text in the DOM (title still holds full value for hover). */
const CSV_CELL_DISPLAY_CAP = 120

/**
 * Sheet-style CSV: sticky header/gutter, windowed rows+cols, cell/row/col pick
 * using the same preview-select-region chrome as code/MD.
 */
function CsvView({
  model,
  selecting,
  selectedIds,
  onSelect
}: {
  model: ReturnType<typeof parseCsvModel>
  selecting: boolean
  selectedIds: string[]
  onSelect: (
    id: string,
    event?: React.MouseEvent | ClickPickPointer | null,
    hint?: PreviewBlock
  ) => void
}): React.JSX.Element {
  const t = useT()
  const [rowStart, setRowStart] = useState(0)
  const [colStart, setColStart] = useState(0)
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])

  useEffect(() => {
    setRowStart(0)
    setColStart(0)
  }, [model])

  // Keep the selected row/col visible when selection changes from outside.
  useEffect(() => {
    for (const id of selectedIds) {
      const cell = /^cell-r(\d+)-c(\d+)$/.exec(id)
      const row = /^row-(\d+)$/.exec(id)
      const col = /^col-/.exec(id)
      if (cell) {
        const ri = Number(cell[1]) - 1
        const ci = Number(cell[2])
        if (ri >= 0 && ri < model.rows.length) {
          if (ri < rowStart || ri >= rowStart + CSV_WINDOW) {
            setRowStart(Math.max(0, Math.min(model.rows.length - CSV_WINDOW, ri - 10)))
          }
        }
        if (ci >= 0) {
          if (ci < colStart || ci >= colStart + CSV_COL_WINDOW) {
            setColStart(Math.max(0, ci - 4))
          }
        }
        break
      }
      if (row) {
        const ri = Number(row[1]) - 1
        if (ri >= 0 && ri < model.rows.length) {
          if (ri < rowStart || ri >= rowStart + CSV_WINDOW) {
            setRowStart(Math.max(0, Math.min(model.rows.length - CSV_WINDOW, ri - 10)))
          }
        }
        break
      }
      void col
    }
    // Only react to selection identity, not window offsets themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, model.rows.length])

  if (model.headers.length === 0) return <div className="muted">{t('common.empty')}</div>

  // Avoid Math.max(...spread) on huge row arrays (stack/alloc blow-up).
  let maxRowCols = model.headers.length
  const probe = Math.min(model.rows.length, 50)
  for (let i = 0; i < probe; i++) {
    const n = model.rows[i]?.length ?? 0
    if (n > maxRowCols) maxRowCols = n
  }
  const totalCols = Math.max(maxRowCols, 1)
  const colEnd = Math.min(totalCols, colStart + CSV_COL_WINDOW)
  const visibleColIndexes = Array.from({ length: colEnd - colStart }, (_, i) => colStart + i)
  const headers = Array.from({ length: totalCols }, (_, i) => model.headers[i] ?? `col${i + 1}`)
  const end = Math.min(model.rows.length, rowStart + CSV_WINDOW)
  const slice = model.rows.slice(rowStart, end)
  const total = model.rows.length

  const pick = (id: string, event: React.MouseEvent, hint?: PreviewBlock): void => {
    // Click (not drag) → conversation pick; drag → native text select/copy.
    handleClickPickMouseDown(event, () => onSelect(id, null, hint))
  }

  const displayCell = (cell: string): string =>
    cell.length > CSV_CELL_DISPLAY_CAP ? `${cell.slice(0, CSV_CELL_DISPLAY_CAP)}…` : cell

  return (
    <div className={`csv-sheet-root${selecting ? ' selecting' : ''}`}>
      <div className="csv-sheet-toolbar muted tiny">
        <span>
          {total === 0
            ? t('common.empty')
            : `Rows ${rowStart + 1}–${end} / ${total} · Cols ${colStart + 1}–${colEnd} / ${totalCols}`}
        </span>
        <span className="spacer" />
        <button
          type="button"
          className="btn ghost sm"
          disabled={colStart <= 0}
          title={t('common.pageLeft')}
          aria-label={t('common.pageLeft')}
          onClick={() => setColStart((s) => Math.max(0, s - CSV_COL_WINDOW))}
        >
          ←
        </button>
        <button
          type="button"
          className="btn ghost sm"
          disabled={colEnd >= totalCols}
          title={t('common.pageRight')}
          aria-label={t('common.pageRight')}
          onClick={() =>
            setColStart((s) => Math.min(Math.max(0, totalCols - CSV_COL_WINDOW), s + CSV_COL_WINDOW))
          }
        >
          →
        </button>
        <button
          type="button"
          className="btn ghost sm"
          disabled={rowStart <= 0}
          title={t('common.pageUp')}
          aria-label={t('common.pageUp')}
          onClick={() => setRowStart((s) => Math.max(0, s - CSV_WINDOW))}
        >
          ↑
        </button>
        <button
          type="button"
          className="btn ghost sm"
          disabled={end >= total}
          title={t('common.pageDown')}
          aria-label={t('common.pageDown')}
          onClick={() =>
            setRowStart((s) => Math.min(Math.max(0, total - CSV_WINDOW), s + CSV_WINDOW))
          }
        >
          ↓
        </button>
      </div>
      <div className="csv-sheet-wrap file-viewer-table">
        <table
          className="csv-sheet"
          style={{ ['--gutter-digits' as string]: Math.max(2, String(total).length) }}
        >
          <thead>
            <tr>
              {/* Sticky row×col junction — keep a glyph so width never collapses to 72px. */}
              <th className="csv-sheet-gutter csv-sheet-corner" aria-hidden="true">
                #
              </th>
              {visibleColIndexes.map((index) => {
                const name = headers[index] ?? `col${index + 1}`
                const id = csvColId(name, index)
                const on = selecting && selected.has(id)
                return (
                  <th
                    key={id}
                    className={`csv-sheet-colhead preview-select-region${on ? ' selected' : ''}`}
                    data-block-id={id}
                    title={name}
                    onMouseDown={
                      selecting
                        ? (e) => {
                            const hint: PreviewBlock = {
                              id,
                              kind: 'col',
                              text: name,
                              label: `col ${name}`,
                              startLine: 1,
                              endLine: total + 1
                            }
                            pick(id, e, hint)
                          }
                        : undefined
                    }
                  >
                    <span className="csv-sheet-col-label">{name || `col ${index + 1}`}</span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {slice.map((row, offset) => {
              const rowIndex = rowStart + offset
              const rowId = `row-${rowIndex + 1}`
              const rowOn = selecting && selected.has(rowId)
              // Build row hint only if selecting — avoid string work on every paint.
              const rowHint = selecting ? csvRowBlock(headers, row, rowIndex) : undefined
              return (
                <tr key={rowId} className={rowOn ? 'row-selected' : undefined}>
                  <th
                    className={`csv-sheet-gutter preview-select-region${rowOn ? ' selected' : ''}`}
                    data-block-id={rowId}
                    title={selecting ? t('preview.selectRow') : undefined}
                    onMouseDown={
                      selecting && rowHint
                        ? (e) => pick(rowId, e, rowHint)
                        : undefined
                    }
                  >
                    {rowIndex + 1}
                  </th>
                  {visibleColIndexes.map((cellIndex) => {
                    const cell = row[cellIndex] ?? ''
                    const cellId = `cell-r${rowIndex + 1}-c${cellIndex}`
                    const on = selecting && selected.has(cellId)
                    return (
                      <td
                        key={cellId}
                        className={`preview-select-region${on ? ' selected' : ''}${cell ? '' : ' is-empty'}`}
                        data-block-id={cellId}
                        title={cell.length > CSV_CELL_DISPLAY_CAP ? cell : undefined}
                        onMouseDown={
                          selecting
                            ? (e) => {
                                if (!cell.trim()) {
                                  if (rowHint) pick(rowId, e, rowHint)
                                  return
                                }
                                pick(cellId, e, csvCellBlock(headers, row, rowIndex, cellIndex))
                              }
                            : undefined
                        }
                      >
                        {displayCell(cell)}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Windowing / soft caps belong in render — never show as “truncated for preview”. */
function isSilentPreviewWindowWarning(warning: string): boolean {
  return (
    /truncated to \d+\s*[x×]\s*\d+/i.test(warning) ||
    (/truncat/i.test(warning) && /for preview/i.test(warning)) ||
    /Sheet .+ truncated/i.test(warning)
  )
}
