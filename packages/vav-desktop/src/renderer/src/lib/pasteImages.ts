import {
  extensionForImageMime,
  isImageAttachmentPath,
  mimeAllowed,
  type AgentImageInput
} from '@shared/agentImageInput'

export type ClipboardImage = {
  file: File
  mime: string
  bytes: number
}

export function filePathFromDragItem(file: File): string {
  try {
    return window.vav.files.pathForFile(file) || ''
  } catch {
    return ''
  }
}

export function collectClipboardImages(data: DataTransfer | null): {
  filePaths: string[]
  pathSizes: Record<string, number>
  memoryImages: ClipboardImage[]
  text: string
} {
  const filePaths: string[] = []
  const pathSizes: Record<string, number> = {}
  const memoryImages: ClipboardImage[] = []
  const text = data?.getData('text/plain') ?? ''
  if (!data) return { filePaths, pathSizes, memoryImages, text }

  for (const file of data.files) {
    const path = filePathFromDragItem(file)
    if (path) {
      filePaths.push(path)
      if (isImageAttachmentPath(path) && file.size > 0) pathSizes[path] = file.size
      continue
    }
    if (file.type.startsWith('image/') && file.size > 0) {
      memoryImages.push({ file, mime: file.type, bytes: file.size })
    }
  }

  if (filePaths.length === 0 && memoryImages.length === 0) {
    for (const item of data.items) {
      if (!item.type.startsWith('image/')) continue
      const file = item.getAsFile()
      if (!file || file.size <= 0) continue
      memoryImages.push({ file, mime: item.type || file.type, bytes: file.size })
    }
  }

  return { filePaths, pathSizes, memoryImages, text }
}

export function imageSizeByPath(
  files: File[]
): { paths: string[]; sizes: Record<string, number> } {
  const paths: string[] = []
  const sizes: Record<string, number> = {}
  for (const file of files) {
    const path = filePathFromDragItem(file)
    if (!path) continue
    paths.push(path)
    if (isImageAttachmentPath(path)) sizes[path] = file.size
  }
  return { paths, sizes }
}

export async function writeClipboardImage(
  image: ClipboardImage,
  capability: AgentImageInput
): Promise<{ path: string; bytes: number } | { error: 'bad-type' | 'too-large' | 'write' }> {
  const ext = extensionForImageMime(image.mime)
  if (!ext || !mimeAllowed(capability, image.mime)) {
    return { error: 'bad-type' }
  }
  if (image.bytes > capability.maxBytes) return { error: 'too-large' }
  const base64 = await fileToBase64(image.file)
  const result = await window.vav.files.writeClip({
    filename: `paste.${ext}`,
    base64
  })
  if (!result.ok) return { error: 'write' }
  return { path: result.path, bytes: image.bytes }
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}
