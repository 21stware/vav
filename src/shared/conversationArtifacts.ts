/**
 * Session-level artifacts: documents the agent marked as deliberate deliverables.
 *
 * Ordinary source edits and Change Review files are not artifacts. A write
 * counts only when the file carries `<!-- vav-artifact -->` or the write tool
 * was called with `artifact: true`.
 */
import { previewKind } from './previewKind.ts'
import type { FilePreviewKind } from './ipc.ts'
import type { ChatMessage, MessageBlock, ToolCallBlock } from './types.ts'

export type ConversationArtifactTone =
  | 'html'
  | 'document'
  | 'image'
  | 'audio'
  | 'video'
  | 'data'
  | 'code'
  | 'archive'
  | 'other'

export type ConversationArtifact = {
  /** Path as written by the tool (used to open preview). */
  path: string
  relativePath: string
  name: string
  previewKind: FilePreviewKind
  tone: ConversationArtifactTone
  /** Deliverable-looking files (docs, media, HTML) sort above other marked files. */
  featured: boolean
  /** Still being generated on the live turn. */
  draft: boolean
}

/** HTML comment the agent puts at the top of a text deliverable. */
export const ARTIFACT_MARKER = '<!-- vav-artifact -->'

const ARTIFACT_MARKER_RE = /<!--\s*vav-artifact\s*-->/

const WRITE_TOOLS = new Set(['fs_write', 'write', 'write_file', 'create_file', 'edit_file'])

const FEATURED_PREVIEW = new Set<FilePreviewKind>([
  'html',
  'html-clip',
  'pdf',
  'docx',
  'xlsx',
  'pptx',
  'image',
  'audio',
  'video',
  'zip',
  'csv'
])

const FEATURED_EXT = new Set([
  '.md',
  '.markdown',
  '.mdx',
  '.txt',
  '.svg',
  '.drawio',
  '.dio',
  '.mmd',
  '.mermaid'
])

const NOISE_SEGMENT =
  /(^|\/)(node_modules|\.git|__pycache__|\.venv|venv|\.turbo|\.next|\.cache|coverage)(\/|$)/i

const CODE_EXT =
  /\.(ts|tsx|js|jsx|mjs|cjs|cts|mts|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|lua|zig|nim)$/i

const MARKER_SCAN_CHARS = 8_192

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

function fileName(path: string): string {
  const trimmed = normalizeSlashes(path)
  const index = trimmed.lastIndexOf('/')
  return index >= 0 ? trimmed.slice(index + 1) : trimmed
}

function fileExt(path: string): string {
  const name = fileName(path)
  const index = name.lastIndexOf('.')
  return index > 0 ? name.slice(index).toLowerCase() : ''
}

export function artifactPathKey(path: string): string {
  return normalizeSlashes(path).toLowerCase()
}

export function isNoiseArtifactPath(path: string): boolean {
  return NOISE_SEGMENT.test(normalizeSlashes(path))
}

export function relativeArtifactPath(path: string, workdir: string | null | undefined): string {
  if (!workdir) return path
  const file = normalizeSlashes(path)
  const root = normalizeSlashes(workdir)
  if (!root) return path
  if (file === root) return fileName(path)
  const prefix = `${root}/`
  if (file.startsWith(prefix)) return file.slice(prefix.length)
  const lowerFile = file.toLowerCase()
  const lowerRoot = root.toLowerCase()
  if (lowerFile === lowerRoot) return fileName(path)
  if (lowerFile.startsWith(`${lowerRoot}/`)) return file.slice(root.length + 1)
  return path
}

function writeToolName(tool: string): boolean {
  const n = tool.toLowerCase().replace(/[^a-z0-9_]/g, '')
  return WRITE_TOOLS.has(n)
}

function writeToolArgs(input: unknown): Record<string, unknown> | null {
  return typeof input === 'string' ? safeJson(input) : asRecord(input)
}

function writeToolContents(args: Record<string, unknown>): string | null {
  return (
    (typeof args.content === 'string' ? args.content : null) ??
    (typeof args.contents === 'string' ? args.contents : null) ??
    (typeof args.file_contents === 'string' ? args.file_contents : null)
  )
}

/** Path from a Write / fs_write / create_file payload, if any. */
export function writeToolPath(tool: string, input: unknown): string | null {
  if (!writeToolName(tool)) return null
  const args = writeToolArgs(input)
  if (!args) return null
  return (
    asString(args.path) ||
    asString(args.file_path) ||
    asString(args.filePath) ||
    asString(args.filename) ||
    asString(args.target_file) ||
    asString(args.targetFile)
  )
}

export function hasArtifactMarker(content: string): boolean {
  const head = content.length > MARKER_SCAN_CHARS ? content.slice(0, MARKER_SCAN_CHARS) : content
  return ARTIFACT_MARKER_RE.test(head)
}

/** True when this write is an opt-in artifact (file marker or `artifact: true`). */
export function isArtifactWrite(tool: string, input: unknown): boolean {
  if (!writeToolName(tool)) return false
  const args = writeToolArgs(input)
  if (!args) return false
  if (args.artifact === true) return true
  const contents = writeToolContents(args)
  return contents != null && hasArtifactMarker(contents)
}

function safeJson(raw: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(raw))
  } catch {
    return null
  }
}

export function artifactTone(kind: FilePreviewKind, path: string): ConversationArtifactTone {
  if (kind === 'html' || kind === 'html-clip') return 'html'
  if (kind === 'image') return 'image'
  if (kind === 'audio') return 'audio'
  if (kind === 'video') return 'video'
  if (kind === 'zip') return 'archive'
  if (kind === 'csv' || kind === 'sqlite') return 'data'
  if (kind === 'pdf' || kind === 'docx' || kind === 'xlsx' || kind === 'pptx') return 'document'
  const ext = fileExt(path)
  if (FEATURED_EXT.has(ext)) return 'document'
  if (CODE_EXT.test(ext)) return 'code'
  return 'other'
}

export function isFeaturedArtifact(kind: FilePreviewKind, path: string): boolean {
  if (FEATURED_PREVIEW.has(kind)) return true
  return FEATURED_EXT.has(fileExt(path))
}

type DraftEntry = { path: string; draft: boolean; artifact: boolean }

function collectWritePaths(blocks: MessageBlock[] | undefined, into: DraftEntry[]): void {
  if (!blocks) return
  for (const block of blocks) {
    if (block.kind !== 'toolCall') continue
    collectWriteFromTool(block, into)
    if (block.children?.length) collectWritePaths(block.children, into)
  }
}

function collectWriteFromTool(block: ToolCallBlock, into: DraftEntry[]): void {
  if (block.status === 'error' || block.status === 'skipped' || block.status === 'expired') return
  const path = writeToolPath(block.tool, block.input)
  if (!path || isNoiseArtifactPath(path)) return
  into.push({
    path,
    draft: block.status !== 'completed',
    artifact: isArtifactWrite(block.tool, block.input)
  })
}

function upsert(
  map: Map<string, ConversationArtifact>,
  path: string,
  workdir: string | null | undefined,
  draft: boolean
): void {
  if (!path.trim() || isNoiseArtifactPath(path)) return
  const key = artifactPathKey(path)
  const kind = previewKind(path)
  const next: ConversationArtifact = {
    path,
    relativePath: relativeArtifactPath(path, workdir),
    name: fileName(path),
    previewKind: kind,
    tone: artifactTone(kind, path),
    featured: isFeaturedArtifact(kind, path),
    draft
  }
  const prev = map.get(key)
  if (!prev) {
    map.set(key, next)
    return
  }
  map.set(key, {
    ...prev,
    path: next.path,
    relativePath: next.relativePath,
    name: next.name,
    previewKind: next.previewKind,
    tone: next.tone,
    featured: prev.featured || next.featured,
    draft: prev.draft && next.draft
  })
}

export function collectConversationArtifacts(options: {
  messages: ChatMessage[]
  workdir?: string | null
  liveBlocks?: MessageBlock[]
}): ConversationArtifact[] {
  const map = new Map<string, ConversationArtifact>()
  const writes: DraftEntry[] = []
  for (const message of options.messages) {
    if (message.role !== 'assistant') continue
    collectWritePaths(message.blocks, writes)
  }
  if (options.liveBlocks?.length) collectWritePaths(options.liveBlocks, writes)
  for (const write of writes) {
    if (write.artifact) {
      upsert(map, write.path, options.workdir, write.draft)
      continue
    }
    // A completed unmarked overwrite drops a previously marked path.
    if (!write.draft) map.delete(artifactPathKey(write.path))
  }

  const artifacts = [...map.values()]
  artifacts.sort((a, b) => {
    if (a.featured !== b.featured) return a.featured ? -1 : 1
    if (a.draft !== b.draft) return a.draft ? 1 : -1
    return a.name.localeCompare(b.name)
  })
  return artifacts
}
