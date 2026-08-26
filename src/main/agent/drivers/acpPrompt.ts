import { readFile, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import {
  fileNameFromPath,
  fileUri,
  type AcpContentBlock,
  type AcpPromptCapabilities
} from '../../../shared/acpSession.ts'
import { mimeFromImagePath } from '../../../shared/agentImageInput.ts'

const MAX_INLINE_IMAGES = 8
const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024

const INLINE_MIMES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

export async function buildAcpPrompt(input: {
  text: string
  attachments?: string[]
  capabilities?: AcpPromptCapabilities | null
}): Promise<AcpContentBlock[]> {
  const blocks: AcpContentBlock[] = []
  const text = input.text.trim()
  if (text) blocks.push({ type: 'text', text })

  const attachments = (input.attachments ?? []).filter((path) => isAbsolute(path))
  if (attachments.length === 0) {
    return blocks.length ? blocks : [{ type: 'text', text: input.text }]
  }

  const canImage = input.capabilities?.image === true
  let images = 0
  for (const path of attachments) {
    const mime = mimeFromImagePath(path)
    if (canImage && mime && INLINE_MIMES.has(mime) && images < MAX_INLINE_IMAGES) {
      const image = await readInlineImage(path, mime)
      if (image) {
        blocks.push(image)
        images += 1
        continue
      }
    }
    if (input.capabilities?.embeddedContext === true) {
      const embedded = await readEmbeddedText(path)
      if (embedded) {
        blocks.push(embedded)
        continue
      }
    }
    blocks.push({
      type: 'resource_link',
      uri: fileUri(path),
      name: fileNameFromPath(path),
      mimeType: mime ?? undefined
    })
  }

  return blocks.length ? blocks : [{ type: 'text', text: input.text || '' }]
}

const MAX_EMBEDDED_TEXT_BYTES = 64 * 1024

async function readEmbeddedText(path: string): Promise<AcpContentBlock | null> {
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size <= 0 || info.size > MAX_EMBEDDED_TEXT_BYTES) return null
    const data = await readFile(path)
    if (data.includes(0)) return null
    const text = data.toString('utf8')
    return {
      type: 'resource',
      resource: {
        uri: fileUri(path),
        mimeType: 'text/plain',
        text
      }
    }
  } catch {
    return null
  }
}

async function readInlineImage(path: string, mimeType: string): Promise<AcpContentBlock | null> {
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size <= 0 || info.size > MAX_INLINE_IMAGE_BYTES) return null
    const data = (await readFile(path)).toString('base64')
    return { type: 'image', mimeType, data, uri: fileUri(path) }
  } catch {
    return null
  }
}
