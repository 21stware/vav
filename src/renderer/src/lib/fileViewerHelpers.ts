import type { FileInspectResult } from '../../../shared/ipc.ts'
import type { PreviewRef } from '../../../shared/types.ts'
import { localFileStreamUrl } from '../../../shared/localFileUrl.ts'
import { mimeForPreviewKind, previewKind } from '../../../shared/previewKind.ts'
import { blockToPreviewRef, formatBlockPickLabel } from '../../../shared/previewContext.ts'
import { basename, pathsEqual } from './path.ts'
import type { PreviewBlock } from './previewBlocks.ts'

export { pathsEqual }

export function countNewlinesLocal(text: string): number {
  if (!text) return 0
  let n = 1
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) n++
  }
  if (text.charCodeAt(text.length - 1) === 10) n--
  return Math.max(n, 1)
}

export function collectBlocks(blocks: PreviewBlock[]): PreviewBlock[] {
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

export function applyFileDraftContent(
  prev: string | null,
  event: { content?: string; append?: string; baseLen?: number }
): string | null {
  if (typeof event.content === 'string') return event.content
  if (typeof event.append === 'string') {
    const base = prev ?? ''
    if (typeof event.baseLen === 'number' && base.length !== event.baseLen) return prev
    return base + event.append
  }
  return prev
}

/**
 * First inspect window is 128 KB. Keep a longer live draft that still starts
 * with the incoming prefix instead of clobbering unsaved edits.
 */
export function mergeIncomingTextBody(
  prevText: string | null | undefined,
  incoming: string,
  truncated: boolean
): string {
  if (
    truncated &&
    prevText != null &&
    prevText.length > incoming.length &&
    prevText.startsWith(incoming)
  ) {
    return prevText
  }
  return incoming
}

export function mergeTextWindowInspect(
  prev: FileInspectResult | null,
  path: string,
  content: string,
  win: { truncated: boolean; endByte: number; totalBytes: number }
): FileInspectResult | null {
  if (!prev || prev.path !== path) return prev
  const nextText = (prev.text ?? '') + content
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
}

export function selectedBlockIdsForPath(
  cards: { ref: { id: string } }[],
  filePath: string
): string[] {
  const prefix = `${filePath}::`
  return cards.filter((c) => c.ref.id.startsWith(prefix)).map((c) => c.ref.id.slice(prefix.length))
}

/** Re-click cancels; empty notes for other blocks are dropped when adding a pick. */
export function nextCommentCardsOnBlockPick(
  existing: { ref: PreviewRef; comment: string }[],
  filePath: string,
  blockId: string,
  ref: PreviewRef
): { cards: { ref: PreviewRef; comment: string }[]; selectedIds: string[]; cancelled: boolean } {
  const refId = `${filePath}::${blockId}`
  if (existing.some((c) => c.ref.id === refId)) {
    const cards = existing.filter((c) => c.ref.id !== refId)
    return { cards, selectedIds: selectedBlockIdsForPath(cards, filePath), cancelled: true }
  }
  const cards = [...existing.filter((c) => c.comment.trim()), { ref, comment: '' }]
  return { cards, selectedIds: selectedBlockIdsForPath(cards, filePath), cancelled: false }
}

/** Ask-agent / analyze: replace the card for this ref, keep other notes. */
export function upsertCommentCard(
  existing: { ref: PreviewRef; comment: string }[],
  ref: PreviewRef
): { ref: PreviewRef; comment: string }[] {
  return [...existing.filter((c) => c.ref.id !== ref.id), { ref, comment: '' }]
}

/** Human title for the comment card header (kind · line N). */
export function formatCommentCardLabel(block: PreviewBlock): string {
  return formatBlockPickLabel(block)
}

/** One selected preview block → a composer comment-block reference. */
export function blockToRef(path: string, badge: string, block: PreviewBlock): PreviewRef {
  return blockToPreviewRef(path, badge, block)
}

/** Windowing / soft caps belong in render — never show as “truncated for preview”. */
export function isSilentPreviewWindowWarning(warning: string): boolean {
  return (
    /truncated to \d+\s*[x×]\s*\d+/i.test(warning) ||
    (/truncat/i.test(warning) && /for preview/i.test(warning)) ||
    /Sheet .+ truncated/i.test(warning)
  )
}

export function provisionalInspect(path: string): FileInspectResult | null {
  const name = basename(path)
  const kind = previewKind(name)
  // Text/CSV/HTML need inspect bytes — don't flash an empty canvas.
  if (kind === 'binary' || kind === 'directory' || kind === 'text' || kind === 'csv') {
    return null
  }
  const base = {
    path,
    name,
    size: 0,
    kind,
    mime: mimeForPreviewKind(name, kind),
    streamUrl: localFileStreamUrl(path)
  }
  if (kind === 'zip') {
    return {
      ...base,
      zip: {
        entries: [],
        entryCount: 0,
        compressedSize: 0,
        uncompressedSize: 0,
        ratio: 0
      }
    }
  }
  return base
}

/** Prefer the file-session agent, then the parent session, then the sidebar. */
export function filesHostConversationId(
  agentConversationId?: string | null,
  parentConversationId?: string | null,
  fallbackActiveId?: string | null
): string | undefined {
  return agentConversationId || parentConversationId || fallbackActiveId || undefined
}

export const PANEL_WIDTH_KEY = 'vav.filePreviewAgentPanelWidth'
export const PANEL_WIDTH_MIN = 280
export const PANEL_WIDTH_MAX = 520
export const PANEL_WIDTH_DEFAULT = 360

export function clampPanelWidth(width: number): number {
  return Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, width))
}

export function loadPanelWidth(getItem?: (key: string) => string | null): number {
  try {
    const read = getItem ?? ((key) => localStorage.getItem(key))
    const n = Number(read(PANEL_WIDTH_KEY))
    if (n >= PANEL_WIDTH_MIN && n <= PANEL_WIDTH_MAX) return n
  } catch {
    // ignore
  }
  return PANEL_WIDTH_DEFAULT
}

export function persistPanelWidth(
  width: number,
  setItem?: (key: string, value: string) => void
): void {
  try {
    const write = setItem ?? ((key, value) => localStorage.setItem(key, value))
    write(PANEL_WIDTH_KEY, String(width))
  } catch {
    // ignore
  }
}

/** True when `path` is the session root or a descendant (never a parent). */
export function pathIsUnderWorkspaceRoot(
  path: string,
  root: string | null | undefined
): boolean {
  if (!root || root.startsWith('__')) return false
  return path === root || path.startsWith(`${root}/`) || path.startsWith(`${root}\\`)
}

/**
 * Point the Files tray at the open file's enclosed directory unless the
 * session is already rooted at a project that contains this file.
 */
export async function bindFilePreviewWorkspace(opts: {
  conversationId: string
  path: string
  dir: string
  workingDirectory: string | null | undefined
  selectPath: (conversationId: string, path: string) => void
  setConversationWorkingDirectory: (conversationId: string, dir: string) => Promise<void>
  setWorkspaceWorkingDirectory: (conversationId: string, dir: string) => Promise<void>
  setPanelSegmentQuiet: (segment: 'files' | 'terminal') => void
  setToolsCollapsed: (collapsed: boolean) => void
  markEnclosedDirChip: (conversationId: string) => void
  /** Re-read after workdir awaits so a mid-session open tray stays open. */
  toolsCollapsed: () => boolean
}): Promise<'select-only' | 'bound'> {
  if (pathIsUnderWorkspaceRoot(opts.path, opts.workingDirectory)) {
    opts.selectPath(opts.conversationId, opts.path)
    return 'select-only'
  }
  if ((opts.workingDirectory ?? null) !== opts.dir) {
    await opts.setConversationWorkingDirectory(opts.conversationId, opts.dir)
  } else {
    await opts.setWorkspaceWorkingDirectory(opts.conversationId, opts.dir)
  }
  opts.selectPath(opts.conversationId, opts.path)
  const wasCollapsed = opts.toolsCollapsed()
  opts.setPanelSegmentQuiet('files')
  if (wasCollapsed) opts.setToolsCollapsed(true)
  opts.markEnclosedDirChip(opts.conversationId)
  return 'bound'
}

/** Open preview path may be the real file while the agent writes the sandbox copy. */
export async function isOpenFilePath(
  openPath: string,
  sourcePath: string,
  workingCopyStatus?: (
    path: string
  ) => Promise<{ realPath: string; copyPath: string } | null | undefined>
): Promise<boolean> {
  if (pathsEqual(openPath, sourcePath)) return true
  if (!workingCopyStatus) return false
  const status = await workingCopyStatus(openPath)
  if (!status) return false
  return pathsEqual(sourcePath, status.copyPath) || pathsEqual(sourcePath, status.realPath)
}

/** Standalone uses local state; workspace peek is always open unless a parent toggle exists. */
export function fileViewerAgentPanelOpen(opts: {
  embedded: boolean
  hasToggle: boolean
  propOpen?: boolean
  localOpen: boolean
}): boolean {
  if (!opts.embedded) return opts.localOpen
  if (opts.hasToggle) return !!opts.propOpen
  return true
}

export function previewBlocksFromSqliteTables(
  tables: Array<{ name: string; columns: string[]; rowCount: number }>
): PreviewBlock[] {
  return tables.map((tb) => ({
    id: `db-table-${tb.name}`,
    kind: 'table' as const,
    text: [`TABLE ${tb.name}`, `columns: ${tb.columns.join(', ')}`, `rows: ${tb.rowCount}`].join(
      '\n'
    ),
    label: `table ${tb.name}`,
    startLine: 0,
    endLine: 0
  }))
}

export function previewBlocksFromZipEntries(
  entries: Array<{ path: string; isDirectory: boolean }>
): PreviewBlock[] {
  return entries.map((e) => ({
    id: `zip:${e.path}`,
    kind: (e.isDirectory ? 'section' : 'code') as PreviewBlock['kind'],
    text: `${e.isDirectory ? 'DIR' : 'FILE'} ${e.path}`,
    label: `ZIP · ${e.path}`,
    startLine: 0,
    endLine: 0
  }))
}
