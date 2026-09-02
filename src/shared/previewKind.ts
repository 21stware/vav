/**
 * Single source of truth for File Preview kind detection.
 *
 * Used by main-process inspect and renderer first-paint so every surface
 * (workspace drawer, companion window, File Session) classifies a path
 * the same way.
 */

import type { FilePreviewKind } from './ipc'

/** Image extensions that open the media canvas (not the text viewer). */
export const PREVIEW_IMAGE_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.svg',
  '.ico',
  '.avif',
  '.heic',
  '.heif',
  '.hif',
  '.tif',
  '.tiff'
])

export const PREVIEW_AUDIO_EXTS = new Set([
  '.mp3',
  '.wav',
  '.m4a',
  '.aac',
  '.ogg',
  '.flac',
  '.opus'
])

export const PREVIEW_VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm', '.mkv', '.m4v', '.avi'])

/** Known text / source extensions for in-app preview (plus extensionless names). */
export const TEXT_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.py',
  '.pyi',
  '.pyw',
  '.rb',
  '.php',
  '.pl',
  '.pm',
  '.lua',
  '.r',
  '.jl',
  '.c',
  '.h',
  '.cc',
  '.cpp',
  '.cxx',
  '.hpp',
  '.hh',
  '.m',
  '.mm',
  '.swift',
  '.go',
  '.rs',
  '.zig',
  '.nim',
  '.cs',
  '.fs',
  '.fsx',
  '.java',
  '.kt',
  '.kts',
  '.scala',
  '.groovy',
  '.dart',
  '.ex',
  '.exs',
  '.erl',
  '.hrl',
  '.hs',
  '.lhs',
  '.clj',
  '.cljs',
  '.edn',
  '.html',
  '.htm',
  '.xhtml',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.vue',
  '.svelte',
  '.astro',
  '.xml',
  '.xsl',
  '.xslt',
  '.svg',
  '.json',
  '.jsonc',
  '.json5',
  '.yml',
  '.yaml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.config',
  '.properties',
  '.env',
  '.envrc',
  '.plist',
  '.tf',
  '.hcl',
  '.tfvars',
  '.proto',
  '.graphql',
  '.gql',
  '.sql',
  '.prisma',
  '.md',
  '.markdown',
  '.mdx',
  '.rst',
  '.adoc',
  '.tex',
  '.txt',
  '.text',
  '.log',
  '.csv',
  '.tsv',
  '.ipynb',
  '.rpml',
  '.mmd',
  '.mermaid',
  '.dot',
  '.gv',
  '.opml',
  '.drawio',
  '.dio',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.ps1',
  '.psm1',
  '.bat',
  '.cmd',
  '.cmake',
  '.make',
  '.mk',
  '.gradle',
  '.dockerignore',
  '.gitignore',
  '.gitattributes',
  '.editorconfig',
  '.npmrc',
  '.nvmrc',
  '.prettierrc',
  '.eslintrc',
  '.babelrc',
  '.lock'
])

export const TEXT_BASENAMES = new Set([
  'dockerfile',
  'makefile',
  'gnumakefile',
  'cmakelists.txt',
  'readme',
  'license',
  'licence',
  'changelog',
  'authors',
  'gemfile',
  'rakefile',
  'procfile',
  'vagrantfile',
  'brewfile',
  'justfile'
])

function fileBase(name: string): string {
  const normalized = name.replace(/\\/g, '/')
  const i = normalized.lastIndexOf('/')
  return (i >= 0 ? normalized.slice(i + 1) : name).toLowerCase()
}

function fileExt(name: string): string {
  const base = fileBase(name)
  const dot = base.lastIndexOf('.')
  return dot >= 0 ? base.slice(dot) : ''
}

/** Interactive HTML surfaces that stay chrome-less / script-allowed. */
export function isHtmlClipName(name: string): boolean {
  const base = fileBase(name)
  return (
    fileExt(name) === '.html-clip' ||
    base === 'app.html' ||
    base === 'xstate.html' ||
    base.endsWith('.app.html')
  )
}

/**
 * Classify a file name for File Preview. Directory / sniff-as-text upgrades
 * happen in inspect after stat — this is extension-only.
 */
export function previewKind(name: string): FilePreviewKind {
  const base = fileBase(name)
  const ext = fileExt(name)
  if (ext === '.csv' || ext === '.tsv') return 'csv'
  if (PREVIEW_IMAGE_EXTS.has(ext)) return 'image'
  if (ext === '.pdf') return 'pdf'
  if (ext === '.zip') return 'zip'
  if (ext === '.docx') return 'docx'
  if (ext === '.xlsx' || ext === '.xls') return 'xlsx'
  if (ext === '.pptx') return 'pptx'
  if (isHtmlClipName(name)) return 'html-clip'
  if (ext === '.html' || ext === '.htm' || ext === '.xhtml') return 'html'
  if (ext === '.db' || ext === '.sqlite' || ext === '.sqlite3' || ext === '.db3') return 'sqlite'
  if (PREVIEW_AUDIO_EXTS.has(ext)) return 'audio'
  if (PREVIEW_VIDEO_EXTS.has(ext)) return 'video'
  if (TEXT_EXTENSIONS.has(ext) || TEXT_BASENAMES.has(base) || !ext) {
    return 'text'
  }
  if (
    base.startsWith('.') &&
    (base.endsWith('rc') ||
      base.endsWith('ignore') ||
      base.startsWith('.env') ||
      base.includes('eslint') ||
      base.includes('prettier') ||
      base.includes('babel'))
  ) {
    return 'text'
  }
  return 'binary'
}

/** MIME for a classified preview kind (best-effort; inspect may refine). */
export function mimeForPreviewKind(name: string, kind: FilePreviewKind): string {
  const ext = fileExt(name)
  switch (kind) {
    case 'image':
      if (ext === '.png') return 'image/png'
      if (ext === '.gif') return 'image/gif'
      if (ext === '.webp') return 'image/webp'
      if (ext === '.svg') return 'image/svg+xml'
      if (ext === '.heic' || ext === '.heif' || ext === '.hif') return 'image/heic'
      if (ext === '.tif' || ext === '.tiff') return 'image/tiff'
      if (ext === '.avif') return 'image/avif'
      if (ext === '.bmp') return 'image/bmp'
      if (ext === '.ico') return 'image/x-icon'
      return 'image/jpeg'
    case 'audio':
      if (ext === '.wav') return 'audio/wav'
      if (ext === '.m4a') return 'audio/mp4'
      return 'audio/mpeg'
    case 'video':
      if (ext === '.webm') return 'video/webm'
      if (ext === '.mov') return 'video/quicktime'
      return 'video/mp4'
    case 'pdf':
      return 'application/pdf'
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    case 'pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    case 'html':
    case 'html-clip':
      return ext === '.xhtml' ? 'application/xhtml+xml' : 'text/html'
    case 'csv':
      return 'text/csv'
    case 'sqlite':
      return 'application/vnd.sqlite3'
    case 'zip':
      return 'application/zip'
    case 'directory':
      return 'inode/directory'
    case 'binary': {
      if (ext === '.dmg') return 'application/x-apple-diskimage'
      if (ext === '.apk') return 'application/vnd.android.package-archive'
      if (ext === '.pkg') return 'application/x-newton-compatible-pkg'
      return 'application/octet-stream'
    }
    default:
      return 'text/plain'
  }
}

/** Kinds that share the office/PDF native canvas router. */
export function isOfficePreviewKind(kind: FilePreviewKind | string | null | undefined): boolean {
  return kind === 'pdf' || kind === 'docx' || kind === 'xlsx' || kind === 'pptx'
}

/** Kinds whose canvas is a rendered document (not raw bytes / archive / media). */
export function isDocumentPreviewKind(kind: FilePreviewKind | string | null | undefined): boolean {
  return (
    kind === 'text' ||
    kind === 'csv' ||
    kind === 'html' ||
    kind === 'html-clip' ||
    isOfficePreviewKind(kind)
  )
}
