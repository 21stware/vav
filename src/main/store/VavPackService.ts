/**
 * Build and restore `.vavpack` session packages.
 *
 * Export produces a ZIP (custom suffix) with:
 * - manifest.json
 * - conversations/*.json (text; large base64 externalized)
 * - blobs/* (raw binary)
 * - attachments/* (files that were still on disk)
 *
 * Import reconstitutes conversations into ConversationStore, writing blobs
 * under the new session workdir so history stays lean.
 */

import { createHash, randomUUID } from 'node:crypto'
import { basename, extname, join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { app, BrowserWindow, dialog } from 'electron'
import JSZip from 'jszip'
import type { ChatMessage, Conversation, MessageBlock, ToolCallBlock } from '@shared/types'
import {
  VAVPACK_EXTENSION,
  VAVPACK_FORMAT,
  VAVPACK_VERSION,
  blobMarker,
  isVavpackManifest,
  suggestVavpackName,
  type VavpackBlobEntry,
  type VavpackManifest
} from '@shared/vavpack'
import type { ConversationStore } from './ConversationStore'

/** Externalize base64 runs longer than this (decoded ~1.5 KB). */
const MIN_BASE64_CHARS = 2048
/** Skip individual attachment files larger than this. */
const MAX_ATTACHMENT_BYTES = 80 * 1024 * 1024

const BASE64_CHUNK_RE = /(?:data:[^;,\s]+;base64,)?([A-Za-z0-9+/]{2048,}={0,2})/g

export type ExportPackResult =
  | { ok: true; path: string; blobCount: number; conversationCount: number }
  | { ok: false; cancelled?: boolean; error?: string }

export type ImportPackResult =
  | { ok: true; importedIds: string[]; path: string; blobCount: number }
  | { ok: false; cancelled?: boolean; error?: string }

export class VavPackService {
  constructor(
    private readonly conversations: ConversationStore,
    /** Mint a Temporary Workspace when the exporter's workdir is missing here. */
    private readonly mintWorkdir: () => string = () => {
      const dir = join(app.getPath('temp'), 'vav', randomUUID().slice(0, 8), 'Workspace')
      mkdirSync(dir, { recursive: true })
      return dir
    }
  ) {}

  async exportConversations(
    ids: string[],
    parentWindow?: BrowserWindow | null
  ): Promise<ExportPackResult> {
    const unique = [...new Set(ids.filter(Boolean))]
    if (unique.length === 0) return { ok: false, error: 'No conversations selected' }

    const sources: Conversation[] = []
    for (const id of unique) {
      const c = this.conversations.get(id)
      if (c) sources.push(structuredClone(c))
    }
    if (sources.length === 0) return { ok: false, error: 'Conversations not found' }

    const defaultName = suggestVavpackName(sources[0]!.title, sources.length > 1)
    const saveOpts: Electron.SaveDialogOptions = {
      title: 'Export session package',
      defaultPath: defaultName,
      filters: [
        { name: 'VAV session package', extensions: ['vavpack'] },
        { name: 'All files', extensions: ['*'] }
      ],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    }
    const save = parentWindow
      ? await dialog.showSaveDialog(parentWindow, saveOpts)
      : await dialog.showSaveDialog(saveOpts)
    if (save.canceled || !save.filePath) return { ok: false, cancelled: true }

    let outPath = save.filePath
    if (!outPath.toLowerCase().endsWith(VAVPACK_EXTENSION)) {
      outPath = `${outPath}${VAVPACK_EXTENSION}`
    }

    try {
      const zip = new JSZip()
      const blobEntries: VavpackBlobEntry[] = []
      let blobSeq = 0

      const addBlob = (
        bytes: Buffer,
        opts: {
          kind: VavpackBlobEntry['kind']
          originalPath?: string
          mimeHint?: string
          ext?: string
          source?: VavpackBlobEntry['source']
        }
      ): string => {
        const id = `b${(++blobSeq).toString(36)}`
        const ext = sanitizeExt(opts.ext ?? guessExt(opts.mimeHint, opts.originalPath))
        const path = `blobs/${id}${ext}`
        zip.file(path, bytes, { binary: true, compression: 'DEFLATE' })
        blobEntries.push({
          id,
          path,
          kind: opts.kind,
          size: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          originalPath: opts.originalPath,
          mimeHint: opts.mimeHint,
          source: opts.source
        })
        return id
      }

      const externalizeString = (
        text: string,
        source: VavpackBlobEntry['source']
      ): string => {
        if (!text || text.length < MIN_BASE64_CHARS) return text
        BASE64_CHUNK_RE.lastIndex = 0
        return text.replace(BASE64_CHUNK_RE, (full, b64: string) => {
          if (!b64 || b64.length < MIN_BASE64_CHARS) return full
          if (!looksLikeBase64(b64)) return full
          let bytes: Buffer
          try {
            bytes = Buffer.from(b64, 'base64')
          } catch {
            return full
          }
          // Reject false positives: decoded must be non-trivial and denser than text.
          if (bytes.length < 256) return full
          // If decode expanded weirdly (not ~3/4), skip.
          if (bytes.length < b64.length * 0.5) return full

          const isDataUrl = full.startsWith('data:')
          const mimeHint = isDataUrl
            ? full.slice(5, full.indexOf(';')).trim() || undefined
            : sniffMime(bytes)
          const id = addBlob(bytes, {
            kind: isDataUrl ? 'data-url' : 'base64-extract',
            mimeHint,
            ext: extFromMime(mimeHint),
            source
          })
          return blobMarker(id)
        })
      }

      const packConversation = (conversation: Conversation): Conversation => {
        const messages = conversation.messages.map((message) => {
          const next: ChatMessage = {
            ...message,
            content: externalizeString(message.content, {
              conversationId: conversation.id,
              messageId: message.id,
              field: 'content'
            }),
            blocks: message.blocks.map((block) =>
              externalizeBlock(block, conversation.id, message.id, externalizeString)
            )
          }
          if (message.quoteSummary) {
            next.quoteSummary = externalizeString(message.quoteSummary, {
              conversationId: conversation.id,
              messageId: message.id,
              field: 'quoteSummary'
            })
          }
          if (message.contextBlocks?.length) {
            next.contextBlocks = message.contextBlocks.map((ref) => ({
              ...ref,
              text: externalizeString(ref.text, {
                conversationId: conversation.id,
                messageId: message.id,
                field: 'contextBlocks'
              })
            }))
          }
          return next
        })

        // Pull live attachment files into the package when still present.
        const attachmentPaths = new Set<string>()
        for (const m of conversation.messages) {
          for (const p of m.attachments ?? []) {
            if (p) attachmentPaths.add(p)
          }
          if (m.contextFile) attachmentPaths.add(m.contextFile)
        }
        if (conversation.focusedFilePath) attachmentPaths.add(conversation.focusedFilePath)

        const remappedAttachments = new Map<string, string>()
        for (const abs of attachmentPaths) {
          if (!existsSync(abs)) continue
          try {
            const st = statSync(abs)
            if (!st.isFile() || st.size <= 0 || st.size > MAX_ATTACHMENT_BYTES) continue
            const bytes = readFileSync(abs)
            const name = basename(abs)
            const safeName = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
            const zipPath = `attachments/${conversation.id}/${safeName}`
            // Avoid collisions inside the zip.
            let finalPath = zipPath
            let n = 1
            while (zip.file(finalPath)) {
              const e = extname(safeName)
              const stem = e ? safeName.slice(0, -e.length) : safeName
              finalPath = `attachments/${conversation.id}/${stem}-${n}${e}`
              n++
            }
            zip.file(finalPath, bytes, { binary: true, compression: 'DEFLATE' })
            const id = `att-${createHash('sha1').update(abs).digest('hex').slice(0, 10)}`
            blobEntries.push({
              id,
              path: finalPath,
              kind: 'attachment',
              size: bytes.length,
              sha256: createHash('sha256').update(bytes).digest('hex'),
              originalPath: abs,
              mimeHint: sniffMime(bytes),
              source: { conversationId: conversation.id, field: 'attachment' }
            })
            remappedAttachments.set(abs, finalPath)
          } catch {
            // Skip unreadable attachments.
          }
        }

        // Rewrite attachment paths to package-relative so import can find them.
        if (remappedAttachments.size > 0) {
          for (const m of messages) {
            if (m.attachments?.length) {
              m.attachments = m.attachments.map((p) => remappedAttachments.get(p) ?? p)
            }
            if (m.contextFile && remappedAttachments.has(m.contextFile)) {
              m.contextFile = remappedAttachments.get(m.contextFile)!
            }
          }
        }

        return { ...conversation, messages }
      }

      const manifestConversations: VavpackManifest['conversations'] = []
      for (const source of sources) {
        const packed = packConversation(source)
        const file = `conversations/${source.id}.json`
        zip.file(file, JSON.stringify(packed, null, 2), { compression: 'DEFLATE' })
        manifestConversations.push({
          id: source.id,
          title: source.title,
          file
        })
      }

      const manifest: VavpackManifest = {
        format: VAVPACK_FORMAT,
        version: VAVPACK_VERSION,
        exportedAt: new Date().toISOString(),
        appVersion: app.getVersion(),
        conversations: manifestConversations,
        blobs: blobEntries
      }
      zip.file('manifest.json', JSON.stringify(manifest, null, 2), { compression: 'DEFLATE' })
      zip.file(
        'README.txt',
        [
          'vav session package (.vavpack)',
          '',
          'This is a ZIP archive with a custom extension.',
          'Open it in vav via Import, or rename to .zip to inspect.',
          '',
          `Exported: ${manifest.exportedAt}`,
          `App: ${manifest.appVersion}`,
          `Conversations: ${manifest.conversations.length}`,
          `Binary blobs: ${manifest.blobs.length}`,
          '',
          'Layout:',
          '  manifest.json           — package index',
          '  conversations/<id>.json — session transcript (text)',
          '  blobs/                  — large binaries extracted from base64 dumps',
          '  attachments/            — files that were still on disk at export time',
          ''
        ].join('\n'),
        { compression: 'DEFLATE' }
      )

      const buffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      })
      writeFileSync(outPath, buffer)

      return {
        ok: true,
        path: outPath,
        blobCount: blobEntries.length,
        conversationCount: sources.length
      }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }

  async importPackage(parentWindow?: BrowserWindow | null): Promise<ImportPackResult> {
    const openOpts: Electron.OpenDialogOptions = {
      title: 'Import session package',
      filters: [
        { name: 'VAV session package', extensions: ['vavpack', 'zip'] },
        { name: 'All files', extensions: ['*'] }
      ],
      properties: ['openFile']
    }
    const open = parentWindow
      ? await dialog.showOpenDialog(parentWindow, openOpts)
      : await dialog.showOpenDialog(openOpts)
    if (open.canceled || !open.filePaths[0]) return { ok: false, cancelled: true }

    const packPath = open.filePaths[0]!
    try {
      const raw = readFileSync(packPath)
      const zip = await JSZip.loadAsync(raw)
      const manifestFile = zip.file('manifest.json')
      if (!manifestFile) return { ok: false, error: 'Not a vavpack (missing manifest.json)' }
      const manifestJson = JSON.parse(await manifestFile.async('string')) as unknown
      if (!isVavpackManifest(manifestJson)) {
        return { ok: false, error: 'Invalid vavpack manifest' }
      }
      if (manifestJson.version > VAVPACK_VERSION) {
        return {
          ok: false,
          error: `Package format v${manifestJson.version} is newer than this app supports (v${VAVPACK_VERSION})`
        }
      }

      const importedIds: string[] = []
      const blobById = new Map(manifestJson.blobs.map((b) => [b.id, b]))

      // One materialization root for the whole package import.
      const importRoot = join(app.getPath('userData'), 'vavpack-imports', randomUUID())
      mkdirSync(join(importRoot, 'blobs'), { recursive: true })
      mkdirSync(join(importRoot, 'attachments'), { recursive: true })

      const blobLocalPath = new Map<string, string>()
      for (const blob of manifestJson.blobs) {
        const zf = zip.file(blob.path)
        if (!zf) continue
        const bytes = Buffer.from(await zf.async('nodebuffer'))
        const localName =
          blob.kind === 'attachment'
            ? join(importRoot, 'attachments', basename(blob.path))
            : join(importRoot, 'blobs', basename(blob.path))
        mkdirSync(join(localName, '..'), { recursive: true })
        writeFileSync(localName, bytes)
        blobLocalPath.set(blob.id, localName)
      }

      // Expand markers to short path references (not re-base64 — that was the whole point).
      const expand = (text: string): string => {
        if (!text) return text
        return text.replace(/\{\{vavpack:blob:([a-zA-Z0-9_-]+)\}\}/g, (_m, id: string) => {
          const local = blobLocalPath.get(id)
          const meta = blobById.get(id)
          if (local) {
            const size = meta?.size ?? 0
            return `[binary blob → ${local}${size ? ` (${formatBytes(size)})` : ''}]`
          }
          return `[missing blob:${id}]`
        })
      }

      for (const entry of manifestJson.conversations) {
        const convFile = zip.file(entry.file)
        if (!convFile) continue
        const conversation = JSON.parse(await convFile.async('string')) as Conversation
        if (!conversation?.id || !Array.isArray(conversation.messages)) continue

        const expandedMessages = conversation.messages.map((message) => {
          const next: ChatMessage = {
            ...message,
            content: expand(message.content),
            blocks: message.blocks.map((b) => expandBlock(b, expand))
          }
          if (message.quoteSummary) next.quoteSummary = expand(message.quoteSummary)
          if (message.contextBlocks?.length) {
            next.contextBlocks = message.contextBlocks.map((ref) => ({
              ...ref,
              text: expand(ref.text)
            }))
          }
          // Remap package-relative attachment paths to extracted local files.
          if (message.attachments?.length) {
            next.attachments = message.attachments.map((p) => {
              if (!p.startsWith('attachments/')) return p
              const local = join(importRoot, p)
              return existsSync(local) ? local : p
            })
          }
          if (message.contextFile?.startsWith('attachments/')) {
            const local = join(importRoot, message.contextFile)
            if (existsSync(local)) next.contextFile = local
          }
          return next
        })

        // Prefer the original workdir when it still exists on this machine.
        let workdir = conversation.workingDirectory
        if (!workdir || !existsSync(workdir)) {
          workdir = this.mintWorkdir()
        }

        const imported = this.conversations.importConversation({
          ...conversation,
          messages: expandedMessages,
          pinned: false,
          pinTime: null,
          archived: false,
          archivedAt: null,
          fileId: null,
          fileReadOnly: false,
          workingDirectory: workdir
        })
        importedIds.push(imported.id)
      }

      if (importedIds.length === 0) {
        return { ok: false, error: 'Package contained no importable conversations' }
      }

      return {
        ok: true,
        importedIds,
        path: packPath,
        blobCount: manifestJson.blobs.length
      }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }
}

function externalizeBlock(
  block: MessageBlock,
  conversationId: string,
  messageId: string,
  externalize: (text: string, source: VavpackBlobEntry['source']) => string
): MessageBlock {
  if (block.kind === 'text') {
    return {
      ...block,
      text: externalize(block.text, { conversationId, messageId, field: 'text' })
    }
  }
  if (block.kind === 'reasoning') {
    return {
      ...block,
      text: externalize(block.text, { conversationId, messageId, field: 'reasoning' })
    }
  }
  if (block.kind === 'toolCall') {
    const tool = block as ToolCallBlock
    return {
      ...tool,
      input: externalize(tool.input, {
        conversationId,
        messageId,
        field: `tool:${tool.tool}:input`
      }),
      output: externalize(tool.output, {
        conversationId,
        messageId,
        field: `tool:${tool.tool}:output`
      }),
      summary: tool.summary,
      children: tool.children?.map((child) =>
        externalizeBlock(child, conversationId, messageId, externalize)
      )
    }
  }
  // plan — leave as-is (small structured checklist)
  return block
}

function expandBlock(
  block: MessageBlock,
  expand: (text: string) => string
): MessageBlock {
  if (block.kind === 'text') return { ...block, text: expand(block.text) }
  if (block.kind === 'reasoning') return { ...block, text: expand(block.text) }
  if (block.kind === 'toolCall') {
    return {
      ...block,
      input: expand(block.input),
      output: expand(block.output),
      children: block.children?.map((child) => expandBlock(child, expand))
    }
  }
  return block
}

function looksLikeBase64(s: string): boolean {
  // Allow whitespace-free base64 only for the long runs we match.
  if (!/^[A-Za-z0-9+/]+=*$/.test(s)) return false
  // Alphabet diversity check — pure digits/letters alone are less likely binary dumps.
  const hasPlus = s.includes('+') || s.includes('/')
  const hasUpper = /[A-Z]/.test(s)
  const hasLower = /[a-z]/.test(s)
  const hasDigit = /\d/.test(s)
  const score = Number(hasPlus) + Number(hasUpper) + Number(hasLower) + Number(hasDigit)
  return score >= 3
}

function sniffMime(bytes: Buffer): string | undefined {
  if (bytes.length >= 4) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return 'image/png'
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif'
    if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
      return 'application/pdf'
    }
    if (bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05)) {
      return 'application/zip'
    }
    // SQLite header "SQLite format 3\0"
    if (bytes.subarray(0, 16).toString('utf8').startsWith('SQLite format 3')) {
      return 'application/x-sqlite3'
    }
  }
  return undefined
}

function extFromMime(mime?: string): string {
  switch (mime) {
    case 'image/png':
      return '.png'
    case 'image/jpeg':
      return '.jpg'
    case 'image/gif':
      return '.gif'
    case 'application/pdf':
      return '.pdf'
    case 'application/zip':
      return '.zip'
    case 'application/x-sqlite3':
      return '.db'
    default:
      return '.bin'
  }
}

function guessExt(mime?: string, originalPath?: string): string {
  if (originalPath) {
    const e = extname(originalPath)
    if (e && e.length <= 8) return e
  }
  return extFromMime(mime)
}

function sanitizeExt(ext: string): string {
  if (!ext || ext === '.') return '.bin'
  const clean = ext.replace(/[^a-zA-Z0-9.]/g, '')
  if (!clean.startsWith('.')) return `.${clean.slice(0, 7)}`
  return clean.slice(0, 8) || '.bin'
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
