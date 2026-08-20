/**
 * Preloads composer image attachments as base64 for inline model input.
 *
 * Attachments have always been stored as paths and reconstituted for the model
 * as an `Attachments:` text list. Vision-capable models can do better: pi-ai's
 * message format carries `ImageContent` parts that every API module (Anthropic,
 * OpenAI, Google) converts natively. This module reads the images off disk so
 * `buildHistory` can inline them.
 *
 * Bounds: at most {@link MAX_INLINE_IMAGES} most-recent images ride along, each
 * up to {@link MAX_INLINE_IMAGE_BYTES} — matching the composer's per-message
 * caps. Anything older or oversized stays as the text path reference, so the
 * model still knows the file exists.
 */
import { readFile, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type { Api, Model } from '@earendil-works/pi-ai'
import type { ChatMessage, LeafCompaction } from '@shared/types'
import { IMAGE_MIME, mimeFromImagePath } from '../../shared/agentImageInput.ts'
import { compactionBoundaryIndex, compactionForLeaf } from '../../shared/compaction.ts'
import { threadPath } from '../../shared/thread.ts'

export interface InlineImage {
  /** Base64 bytes, no data: prefix — pi-ai's ImageContent shape. */
  data: string
  mimeType: string
}

export const MAX_INLINE_IMAGES = 8
export const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024

const INLINE_MIMES = new Set<string>([
  IMAGE_MIME.png,
  IMAGE_MIME.jpeg,
  IMAGE_MIME.gif,
  IMAGE_MIME.webp
])

function isInlineImagePath(path: string): boolean {
  const mime = mimeFromImagePath(path)
  return mime != null && INLINE_MIMES.has(mime)
}

/**
 * Image attachments on the live path (compaction boundary respected, same rule
 * as `buildHistory`), newest message first.
 */
function candidatePaths(
  messages: ChatMessage[],
  leafId: string | null,
  compactions?: LeafCompaction[] | null
): string[] {
  const path = threadPath(messages, leafId)
  const boundary = compactionBoundaryIndex(
    path,
    compactionForLeaf(compactions, messages, leafId)
  )
  const out: string[] = []
  for (let i = path.length - 1; i >= boundary; i--) {
    const message = path[i]
    if (!message || message.role !== 'user' || !message.attachments?.length) continue
    for (const att of message.attachments) {
      if (isInlineImagePath(att) && !out.includes(att)) out.push(att)
    }
  }
  return out
}

/**
 * Read up to {@link MAX_INLINE_IMAGES} most-recent image attachments as
 * base64 parts. Text-only models get an empty map (paths stay text). Read
 * failures are skipped, never fatal — the text fallback line always exists.
 */
export async function loadInlineImages(
  messages: ChatMessage[],
  leafId: string | null,
  model: Model<Api>,
  compactions?: LeafCompaction[] | null
): Promise<Map<string, InlineImage>> {
  const out = new Map<string, InlineImage>()
  if (!model.input.includes('image')) return out

  const candidates = candidatePaths(messages, leafId, compactions).slice(
    0,
    MAX_INLINE_IMAGES
  )
  await Promise.all(
    candidates.map(async (path) => {
      if (!isAbsolute(path)) return
      try {
        const info = await stat(path)
        if (!info.isFile() || info.size <= 0 || info.size > MAX_INLINE_IMAGE_BYTES) return
        const bytes = await readFile(path)
        const mimeType = mimeFromImagePath(path)
        if (!mimeType || !INLINE_MIMES.has(mimeType)) return
        out.set(path, { data: bytes.toString('base64'), mimeType })
      } catch {
        // Missing / unreadable: leave it as the text path reference.
      }
    })
  )
  return out
}
