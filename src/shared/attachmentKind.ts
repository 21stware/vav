import { isImageAttachmentPath } from './agentImageInput.ts'

export type AttachmentKind =
  | 'image'
  | 'pdf'
  | 'doc'
  | 'sheet'
  | 'slide'
  | 'code'
  | 'archive'
  | 'audio'
  | 'video'
  | 'text'
  | 'file'

const CODE = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'swift',
  'c',
  'cc',
  'cpp',
  'h',
  'hpp',
  'cs',
  'php',
  'sh',
  'zsh',
  'bash',
  'sql',
  'json',
  'yml',
  'yaml',
  'toml',
  'xml',
  'html',
  'htm',
  'css',
  'scss',
  'less',
  'vue',
  'svelte'
])

const TEXT = new Set(['txt', 'md', 'markdown', 'mdx', 'rtf', 'log', 'csv', 'tsv'])
const ARCHIVE = new Set(['zip', 'tar', 'gz', 'tgz', 'bz2', '7z', 'rar', 'xz'])
const AUDIO = new Set(['mp3', 'wav', 'aac', 'flac', 'm4a', 'ogg', 'aiff'])
const VIDEO = new Set(['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'])
const SHEET = new Set(['xlsx', 'xls', 'xlsm', 'ods', 'csv', 'tsv'])
const SLIDE = new Set(['pptx', 'ppt', 'odp', 'key'])
const DOC = new Set(['docx', 'doc', 'odt', 'pages', 'rtf'])

export function fileExt(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return ''
  return base.slice(dot + 1).toLowerCase()
}

export function attachmentExtLabel(path: string): string {
  const ext = fileExt(path)
  if (!ext) return 'FILE'
  return ext.length > 5 ? ext.slice(0, 5).toUpperCase() : ext.toUpperCase()
}

export function attachmentKindFromPath(path: string): AttachmentKind {
  if (isImageAttachmentPath(path)) return 'image'
  const ext = fileExt(path)
  if (ext === 'pdf') return 'pdf'
  if (SHEET.has(ext)) return 'sheet'
  if (SLIDE.has(ext)) return 'slide'
  if (DOC.has(ext)) return 'doc'
  if (CODE.has(ext)) return 'code'
  if (ARCHIVE.has(ext)) return 'archive'
  if (AUDIO.has(ext)) return 'audio'
  if (VIDEO.has(ext)) return 'video'
  if (TEXT.has(ext)) return 'text'
  return 'file'
}
