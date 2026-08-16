/**
 * Thread image-attachment policy per chat host.
 *
 * Limits are product defaults (API / CLI published caps, rounded down).
 * `null` means the host does not accept images in the composer.
 */

export const IMAGE_MIME = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp'
} as const

export const DEFAULT_IMAGE_MIMES: readonly string[] = [
  IMAGE_MIME.png,
  IMAGE_MIME.jpeg,
  IMAGE_MIME.gif,
  IMAGE_MIME.webp
]

const MB = 1024 * 1024

export type AgentImageInput = {
  maxCount: number
  maxBytes: number
  mime: readonly string[]
}

const CATALOG: Record<string, AgentImageInput> = {
  vav: { maxCount: 8, maxBytes: 5 * MB, mime: DEFAULT_IMAGE_MIMES },
  claude: { maxCount: 20, maxBytes: 5 * MB, mime: DEFAULT_IMAGE_MIMES },
  cursor: { maxCount: 10, maxBytes: 8 * MB, mime: DEFAULT_IMAGE_MIMES },
  grok: { maxCount: 10, maxBytes: 10 * MB, mime: DEFAULT_IMAGE_MIMES },
  codex: { maxCount: 10, maxBytes: 20 * MB, mime: DEFAULT_IMAGE_MIMES },
  opencode: { maxCount: 8, maxBytes: 5 * MB, mime: DEFAULT_IMAGE_MIMES },
  pi: { maxCount: 8, maxBytes: 5 * MB, mime: DEFAULT_IMAGE_MIMES },
  devin: { maxCount: 8, maxBytes: 5 * MB, mime: DEFAULT_IMAGE_MIMES },
  antigravity: { maxCount: 10, maxBytes: 7 * MB, mime: DEFAULT_IMAGE_MIMES },
  kiro: { maxCount: 8, maxBytes: 5 * MB, mime: DEFAULT_IMAGE_MIMES },
  cline: { maxCount: 8, maxBytes: 5 * MB, mime: DEFAULT_IMAGE_MIMES }
}

const IMAGE_EXT_MIME: Record<string, string> = {
  '.png': IMAGE_MIME.png,
  '.jpg': IMAGE_MIME.jpeg,
  '.jpeg': IMAGE_MIME.jpeg,
  '.gif': IMAGE_MIME.gif,
  '.webp': IMAGE_MIME.webp,
  '.bmp': 'image/bmp',
  '.heic': 'image/heic',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.avif': 'image/avif'
}

export type ImageAttachReject = 'unsupported' | 'too-many' | 'too-large' | 'bad-type'

export type ImageAttachPlan = {
  paths: string[]
  maxCount: number
  maxBytes: number
  rejectedUnsupported: number
  droppedForLimit: number
  rejectedOversize: number
  rejectedType: number
}

export function imageInputForChatHost(host: string | null | undefined): AgentImageInput | null {
  if (host == null || host === '' || host === 'vav') return CATALOG.vav ?? null
  return CATALOG[host] ?? null
}

/** Count / size / mime limits even when the model cannot consume images. */
export function imageInputLimits(host: string | null | undefined): AgentImageInput {
  return imageInputForChatHost(host) ?? CATALOG.vav!
}

/**
 * Whether the selected chat host + model will accept image input.
 * Attachments are still allowed when this is false (shown smaller + a hint).
 */
export function modelAcceptsImageInput(
  host: string | null | undefined,
  modelId: string | null | undefined
): boolean {
  if (!imageInputForChatHost(host)) return false
  const id = (modelId ?? '').trim().toLowerCase()
  if (isVavHost(host)) return vavModelAcceptsImage(id)
  if (!id) return true
  return !TEXT_ONLY_MODEL.test(id)
}

function isVavHost(host: string | null | undefined): boolean {
  return host == null || host === '' || host === 'vav'
}

function vavModelAcceptsImage(modelId: string): boolean {
  if (!modelId) return false
  if (TEXT_ONLY_MODEL.test(modelId)) return false
  return VAV_VISION_MODEL.test(modelId)
}

/** Text-only coding models — keep conservative; unknown VAV ids stay false. */
const TEXT_ONLY_MODEL =
  /deepseek|gpt-3\.5|o1(?:-|$)|o3-mini|codestral|starcoder|codellama|qwen[-.]?coder/

const VAV_VISION_MODEL =
  /claude|sonnet|opus|haiku|gpt-4o|gpt-4\.1|gpt-5|gemini|grok/

export function imageExtFromPath(path: string): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const base = slash >= 0 ? path.slice(slash + 1) : path
  const dot = base.lastIndexOf('.')
  if (dot < 0) return ''
  return base.slice(dot).toLowerCase()
}

export function mimeFromImagePath(path: string): string | null {
  return IMAGE_EXT_MIME[imageExtFromPath(path)] ?? null
}

export function isImageAttachmentPath(path: string): boolean {
  return mimeFromImagePath(path) != null
}

export function extensionForImageMime(mime: string): string | null {
  const normalized = mime.toLowerCase().split(';')[0]?.trim() ?? ''
  if (normalized === IMAGE_MIME.png) return 'png'
  if (normalized === IMAGE_MIME.jpeg) return 'jpg'
  if (normalized === IMAGE_MIME.gif) return 'gif'
  if (normalized === IMAGE_MIME.webp) return 'webp'
  return null
}

export function mimeAllowed(capability: AgentImageInput, mime: string | null): boolean {
  if (!mime) return false
  const normalized = mime.toLowerCase().split(';')[0]?.trim() ?? ''
  return capability.mime.includes(normalized)
}

export function mergeImageAttachments(input: {
  existing: string[]
  incoming: string[]
  capability: AgentImageInput | null
  sizes?: Record<string, number>
}): ImageAttachPlan {
  const existing = unique(input.existing)
  const incoming = unique(input.incoming)
  const { images: existingImages, other: existingOther } = splitAttachments(existing)
  const { images: incomingImages, other: incomingOther } = splitAttachments(incoming)
  const other = unique([...existingOther, ...incomingOther])
  const cap = input.capability ?? CATALOG.vav!
  const maxCount = cap.maxCount

  const accepted: string[] = []
  let droppedForLimit = 0
  let rejectedOversize = 0
  let rejectedType = 0

  const consider = (path: string, enforceSize: boolean): void => {
    if (accepted.includes(path)) return
    const mime = mimeFromImagePath(path)
    if (!mimeAllowed(cap, mime)) {
      rejectedType += 1
      return
    }
    const size = input.sizes?.[path]
    if (enforceSize && size != null && size > cap.maxBytes) {
      rejectedOversize += 1
      return
    }
    if (accepted.length >= maxCount) {
      droppedForLimit += 1
      return
    }
    accepted.push(path)
  }

  for (const path of existingImages) consider(path, false)
  for (const path of incomingImages) consider(path, true)

  return {
    paths: [...other, ...accepted],
    maxCount,
    maxBytes: cap.maxBytes,
    rejectedUnsupported: 0,
    droppedForLimit,
    rejectedOversize,
    rejectedType
  }
}

function splitAttachments(paths: string[]): { images: string[]; other: string[] } {
  const images: string[] = []
  const other: string[] = []
  for (const path of paths) {
    if (isImageAttachmentPath(path)) images.push(path)
    else other.push(path)
  }
  return { images, other }
}

function unique(paths: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const path of paths) {
    if (!path || seen.has(path)) continue
    seen.add(path)
    out.push(path)
  }
  return out
}
