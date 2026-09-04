import { extname } from 'node:path'
import type { FilePreviewKind } from '../../shared/ipc.ts'

/** Known text / source extensions for in-app preview (plus extensionless names). */
const TEXT_EXTENSIONS = new Set([
  // JS / TS
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  // Python / scripting
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
  // Systems
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
  // Web / markup
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
  // Data / config
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
  // Docs
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
  // Diagrams / mind maps (text-encoded; .mm may also be ObjC++ — sniff on open)
  '.mmd',
  '.mermaid',
  '.dot',
  '.gv',
  '.opml',
  '.drawio',
  '.dio',
  // Shell / build
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

const TEXT_BASENAMES = new Set([
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

export function previewKind(name: string): FilePreviewKind {
  const base = name.toLowerCase()
  const ext = extname(name).toLowerCase()
  if (ext === '.csv' || ext === '.tsv') return 'csv'
  if (
    [
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
    ].includes(ext)
  ) {
    return 'image'
  }
  if (ext === '.pdf') return 'pdf'
  if (ext === '.zip') return 'zip'
  if (ext === '.docx') return 'docx'
  if (ext === '.xlsx' || ext === '.xls') return 'xlsx'
  if (ext === '.pptx') return 'pptx'
  if (
    ext === '.html-clip' ||
    name.toLowerCase() === 'app.html' ||
    name.toLowerCase() === 'xstate.html' ||
    name.toLowerCase().endsWith('.app.html')
  ) {
    return 'html-clip'
  }
  if (ext === '.html' || ext === '.htm' || ext === '.xhtml') return 'html'
  if (ext === '.db' || ext === '.sqlite' || ext === '.sqlite3' || ext === '.db3') return 'sqlite'
  if (['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.opus'].includes(ext)) return 'audio'
  if (['.mp4', '.mov', '.webm', '.mkv', '.m4v', '.avi'].includes(ext)) return 'video'
  if (TEXT_EXTENSIONS.has(ext) || TEXT_BASENAMES.has(base) || !ext) {
    return 'text'
  }
  // Dotfiles without a second extension (e.g. `.env.local` handled via .local? —
  // `.env*` often ends with a non-empty ext; also accept `.*rc` / `.*ignore`).
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

/** Count lines without allocating a split array (large CSV/text inspect path). */
export function countNewlines(text: string): number {
  if (!text) return 0
  let n = 1
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) n++
  }
  // Trailing newline does not add an extra blank line for display purposes.
  if (text.charCodeAt(text.length - 1) === 10) n--
  return Math.max(n, 1)
}

export function mimeFor(name: string, kind: FilePreviewKind): string {
  const ext = extname(name).toLowerCase()
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
