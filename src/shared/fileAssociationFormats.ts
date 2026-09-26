/**
 * Formats VAV can register as a default opener, plus the document-icon spec
 * Finder / Explorer use when that registration is on.
 *
 * Icon files live at `build/file-icons/{id}.{png,icns,ico}` and are painted
 * from `fileTypeIconSvg.ts` by `scripts/generate-file-type-icons.mjs`, which
 * also rewrites the association blocks in `electron-builder.json`. The same
 * SVG renders in-app (settings, file trees) so the two never drift.
 */

import type { FileTypeGlyph } from './fileTypeIconSvg.ts'

export type FileAssociationCategory = 'text' | 'code' | 'data' | 'media' | 'office'

export interface FileAssociationFormat {
  id: string
  /** Display name */
  label: string
  extensions: string[]
  /** Primary UTI used for Launch Services (macOS) */
  uti: string
  /** Further UTIs claimed alongside `uti` (e.g. headers next to sources). */
  extraUtis?: string[]
  /**
   * macOS ships no declaration for `uti`; VAV imports one conforming to these
   * types so Launch Services can route the extensions to it.
   */
  importConformsTo?: string[]
  /** P0 = fully supported; P1 = listed but secondary */
  tier: 'p0' | 'p1'
  category: FileAssociationCategory
  /** Pictogram drawn on the page. */
  glyph: FileTypeGlyph
  /** 1–5 character label drawn on the document icon. */
  badge: string
  /** Accent for the label, fold and small-size plate (hex). */
  color: string
  /** Text / glyph color on the accent when white would not read (hex). */
  ink?: string
}

/** Icon-only spec shared by formats and the generic fallback document. */
export type FileTypeIconSpec = Pick<FileAssociationFormat, 'id' | 'glyph' | 'color' | 'ink'> & {
  badge?: string
}

/**
 * Catch-all document icon for files VAV opens without a dedicated format
 * (the `public.data` document type). Brand mark, no extension label.
 */
export const GENERIC_FILE_ICON: FileTypeIconSpec & { label: string } = {
  id: 'generic',
  label: 'VAV Document',
  glyph: 'vav',
  color: '#3A3A42'
}

const DB_TYPES = ['public.data', 'public.database']
const SOURCE_TYPES = ['public.source-code', 'public.plain-text']

/** Formats from settings-file-associations.rpml. */
export const FILE_ASSOCIATION_FORMATS: FileAssociationFormat[] = [
  // Text & markup
  { id: 'markdown', label: 'Markdown', extensions: ['.md', '.markdown', '.mdx'], uti: 'net.daringfireball.markdown', tier: 'p0', category: 'text', glyph: 'markdown', badge: 'MD', color: '#2B2838' },
  { id: 'plaintext', label: 'Plain Text', extensions: ['.txt', '.text'], uti: 'public.plain-text', tier: 'p0', category: 'text', glyph: 'text', badge: 'TXT', color: '#686872' },
  { id: 'log', label: 'Log File', extensions: ['.log'], uti: 'com.apple.log', tier: 'p1', category: 'text', glyph: 'log', badge: 'LOG', color: '#7A6852' },

  // Source code
  { id: 'html', label: 'HTML', extensions: ['.html', '.htm', '.xhtml'], uti: 'public.html', tier: 'p0', category: 'code', glyph: 'globe', badge: 'HTML', color: '#D0461E' },
  { id: 'typescript', label: 'TypeScript', extensions: ['.ts', '.tsx', '.mts', '.cts'], uti: 'com.microsoft.typescript', importConformsTo: SOURCE_TYPES, tier: 'p0', category: 'code', glyph: 'code', badge: 'TS', color: '#2F74C0' },
  { id: 'javascript', label: 'JavaScript', extensions: ['.js', '.jsx', '.mjs', '.cjs'], uti: 'com.netscape.javascript-source', tier: 'p0', category: 'code', glyph: 'code', badge: 'JS', color: '#F2D340', ink: '#2B2508' },
  { id: 'python', label: 'Python Source', extensions: ['.py', '.pyi', '.pyw'], uti: 'public.python-script', tier: 'p0', category: 'code', glyph: 'code', badge: 'PY', color: '#2C5A85' },
  { id: 'swift', label: 'Swift Source', extensions: ['.swift'], uti: 'public.swift-source', tier: 'p0', category: 'code', glyph: 'code', badge: 'SWIFT', color: '#E4502E' },
  { id: 'css', label: 'Stylesheet', extensions: ['.css', '.scss', '.sass', '.less'], uti: 'public.css', tier: 'p1', category: 'code', glyph: 'hash', badge: 'CSS', color: '#6B3FB4' },
  { id: 'xml', label: 'XML', extensions: ['.xml', '.xsl', '.xslt'], uti: 'public.xml', tier: 'p1', category: 'code', glyph: 'tags', badge: 'XML', color: '#8C5A1C' },
  { id: 'go', label: 'Go Source', extensions: ['.go'], uti: 'org.golang.go-script', tier: 'p1', category: 'code', glyph: 'code', badge: 'GO', color: '#00809C' },
  { id: 'rust', label: 'Rust Source', extensions: ['.rs'], uti: 'org.rust-lang.rust-script', tier: 'p1', category: 'code', glyph: 'code', badge: 'RS', color: '#B4410F' },
  { id: 'java', label: 'Java Source', extensions: ['.java'], uti: 'com.sun.java-source', tier: 'p1', category: 'code', glyph: 'code', badge: 'JAVA', color: '#8A4B2B' },
  { id: 'kotlin', label: 'Kotlin Source', extensions: ['.kt', '.kts'], uti: 'org.kotlinlang.source', tier: 'p1', category: 'code', glyph: 'code', badge: 'KT', color: '#7650F0' },
  { id: 'c', label: 'C Source', extensions: ['.c', '.h'], uti: 'public.c-source', extraUtis: ['public.c-header'], tier: 'p1', category: 'code', glyph: 'code', badge: 'C', color: '#52679E' },
  { id: 'cpp', label: 'C++ Source', extensions: ['.cc', '.cpp', '.cxx', '.hpp', '.hh'], uti: 'public.c-plus-plus-source', extraUtis: ['public.c-plus-plus-header'], tier: 'p1', category: 'code', glyph: 'code', badge: 'C++', color: '#00599C' },
  { id: 'csharp', label: 'C# Source', extensions: ['.cs'], uti: 'com.microsoft.c-sharp', tier: 'p1', category: 'code', glyph: 'code', badge: 'C#', color: '#68217A' },
  { id: 'ruby', label: 'Ruby Script', extensions: ['.rb'], uti: 'public.ruby-script', tier: 'p1', category: 'code', glyph: 'code', badge: 'RB', color: '#A81D48' },
  { id: 'php', label: 'PHP Script', extensions: ['.php'], uti: 'public.php-script', tier: 'p1', category: 'code', glyph: 'code', badge: 'PHP', color: '#5E63A0' },
  { id: 'shell', label: 'Shell Script', extensions: ['.sh', '.bash', '.zsh', '.fish'], uti: 'public.shell-script', extraUtis: ['public.bash-script', 'public.zsh-script'], tier: 'p1', category: 'code', glyph: 'terminal', badge: 'SH', color: '#2E3B34' },

  // Data & config
  { id: 'json', label: 'JSON', extensions: ['.json', '.jsonc', '.json5'], uti: 'public.json', tier: 'p0', category: 'data', glyph: 'braces', badge: 'JSON', color: '#A76800' },
  { id: 'yaml', label: 'YAML', extensions: ['.yaml', '.yml'], uti: 'public.yaml', tier: 'p0', category: 'data', glyph: 'tree', badge: 'YAML', color: '#9A3C7E' },
  { id: 'csv', label: 'CSV', extensions: ['.csv', '.tsv'], uti: 'public.comma-separated-values-text', extraUtis: ['public.tab-separated-values-text'], tier: 'p0', category: 'data', glyph: 'table', badge: 'CSV', color: '#2A7A57' },
  { id: 'notebook', label: 'Jupyter Notebook', extensions: ['.ipynb'], uti: 'org.jupyter.ipynb', importConformsTo: ['public.json'], tier: 'p0', category: 'data', glyph: 'cells', badge: 'IPYNB', color: '#C95F0A' },
  { id: 'toml', label: 'TOML', extensions: ['.toml'], uti: 'public.toml', tier: 'p1', category: 'data', glyph: 'brackets', badge: 'TOML', color: '#8E4A2E' },
  { id: 'config', label: 'Config File', extensions: ['.ini', '.cfg', '.conf'], uti: 'com.microsoft.ini', tier: 'p1', category: 'data', glyph: 'sliders', badge: 'INI', color: '#56606E' },
  { id: 'sql', label: 'SQL', extensions: ['.sql'], uti: 'org.iso.sql', tier: 'p1', category: 'data', glyph: 'query', badge: 'SQL', color: '#1F7185' },
  { id: 'sqlite', label: 'SQLite Database', extensions: ['.db', '.sqlite', '.sqlite3', '.db3'], uti: 'org.sqlite.sqlite3', importConformsTo: DB_TYPES, tier: 'p1', category: 'data', glyph: 'database', badge: 'DB', color: '#1E5A94' },
  { id: 'duckdb', label: 'DuckDB Database', extensions: ['.duckdb'], uti: 'org.duckdb.database', importConformsTo: DB_TYPES, tier: 'p1', category: 'data', glyph: 'database', badge: 'DUCK', color: '#F1C232', ink: '#2A2206' },
  { id: 'parquet', label: 'Parquet', extensions: ['.parquet'], uti: 'org.apache.parquet', importConformsTo: ['public.data'], tier: 'p1', category: 'data', glyph: 'columns', badge: 'PARQ', color: '#4E6F2C' },

  // Images, audio, video
  { id: 'png', label: 'PNG Image', extensions: ['.png'], uti: 'public.png', tier: 'p1', category: 'media', glyph: 'image', badge: 'PNG', color: '#0E8483' },
  { id: 'jpeg', label: 'JPEG Image', extensions: ['.jpg', '.jpeg'], uti: 'public.jpeg', tier: 'p1', category: 'media', glyph: 'image', badge: 'JPG', color: '#15719F' },
  { id: 'gif', label: 'GIF Image', extensions: ['.gif'], uti: 'com.compuserve.gif', tier: 'p1', category: 'media', glyph: 'image', badge: 'GIF', color: '#0D8661' },
  { id: 'webp', label: 'WebP Image', extensions: ['.webp'], uti: 'org.webmproject.webp', tier: 'p1', category: 'media', glyph: 'image', badge: 'WEBP', color: '#28739C' },
  { id: 'avif', label: 'AVIF Image', extensions: ['.avif'], uti: 'public.avif', tier: 'p1', category: 'media', glyph: 'image', badge: 'AVIF', color: '#1B6E7A' },
  { id: 'heic', label: 'HEIC Image', extensions: ['.heic', '.heif', '.hif'], uti: 'public.heic', extraUtis: ['public.heif'], tier: 'p1', category: 'media', glyph: 'image', badge: 'HEIC', color: '#7A4A98' },
  { id: 'tiff', label: 'TIFF Image', extensions: ['.tif', '.tiff'], uti: 'public.tiff', tier: 'p1', category: 'media', glyph: 'image', badge: 'TIFF', color: '#4A6A86' },
  { id: 'bmp', label: 'BMP Image', extensions: ['.bmp'], uti: 'com.microsoft.bmp', tier: 'p1', category: 'media', glyph: 'image', badge: 'BMP', color: '#3F6F6A' },
  { id: 'ico', label: 'Icon Image', extensions: ['.ico'], uti: 'com.microsoft.ico', tier: 'p1', category: 'media', glyph: 'image', badge: 'ICO', color: '#5B6A2E' },
  { id: 'svg', label: 'SVG Image', extensions: ['.svg'], uti: 'public.svg-image', tier: 'p1', category: 'media', glyph: 'pen', badge: 'SVG', color: '#D2691A' },
  { id: 'mp3', label: 'MP3 Audio', extensions: ['.mp3'], uti: 'public.mp3', tier: 'p1', category: 'media', glyph: 'music', badge: 'MP3', color: '#C2185B' },
  { id: 'wav', label: 'WAV Audio', extensions: ['.wav'], uti: 'com.microsoft.waveform-audio', tier: 'p1', category: 'media', glyph: 'music', badge: 'WAV', color: '#A3246E' },
  { id: 'm4a', label: 'AAC Audio', extensions: ['.m4a', '.aac'], uti: 'com.apple.m4a-audio', extraUtis: ['public.aac-audio'], tier: 'p1', category: 'media', glyph: 'music', badge: 'M4A', color: '#B8335A' },
  { id: 'flac', label: 'FLAC Audio', extensions: ['.flac'], uti: 'org.xiph.flac', tier: 'p1', category: 'media', glyph: 'music', badge: 'FLAC', color: '#8A2C8A' },
  { id: 'ogg', label: 'Ogg Audio', extensions: ['.ogg', '.opus'], uti: 'org.xiph.ogg-audio', tier: 'p1', category: 'media', glyph: 'music', badge: 'OGG', color: '#95305F' },
  { id: 'mp4', label: 'MP4 Video', extensions: ['.mp4', '.m4v'], uti: 'public.mpeg-4', extraUtis: ['com.apple.m4v-video'], tier: 'p1', category: 'media', glyph: 'play', badge: 'MP4', color: '#5A3CC0' },
  { id: 'mov', label: 'QuickTime Movie', extensions: ['.mov'], uti: 'com.apple.quicktime-movie', tier: 'p1', category: 'media', glyph: 'play', badge: 'MOV', color: '#4337A6' },
  { id: 'webm', label: 'WebM Video', extensions: ['.webm'], uti: 'org.webmproject.webm', tier: 'p1', category: 'media', glyph: 'play', badge: 'WEBM', color: '#3B55B8' },
  { id: 'mkv', label: 'Matroska Video', extensions: ['.mkv'], uti: 'org.matroska.mkv', importConformsTo: ['public.movie'], tier: 'p1', category: 'media', glyph: 'play', badge: 'MKV', color: '#5B30A0' },
  { id: 'avi', label: 'AVI Video', extensions: ['.avi'], uti: 'public.avi', tier: 'p1', category: 'media', glyph: 'play', badge: 'AVI', color: '#6A3E96' },

  // Documents & archives
  { id: 'pdf', label: 'PDF', extensions: ['.pdf'], uti: 'com.adobe.pdf', tier: 'p1', category: 'office', glyph: 'book', badge: 'PDF', color: '#CF3A2E' },
  { id: 'docx', label: 'Word Document', extensions: ['.docx'], uti: 'org.openxmlformats.wordprocessingml.document', tier: 'p1', category: 'office', glyph: 'pilcrow', badge: 'DOCX', color: '#2B579A' },
  { id: 'xlsx', label: 'Excel Spreadsheet', extensions: ['.xlsx', '.xls'], uti: 'org.openxmlformats.spreadsheetml.sheet', extraUtis: ['com.microsoft.excel.xls'], tier: 'p1', category: 'office', glyph: 'grid', badge: 'XLSX', color: '#217346' },
  { id: 'pptx', label: 'PowerPoint Presentation', extensions: ['.pptx'], uti: 'org.openxmlformats.presentationml.presentation', tier: 'p1', category: 'office', glyph: 'slides', badge: 'PPTX', color: '#C43E1C' },
  {
    id: 'zip',
    label: 'ZIP Archive',
    extensions: ['.zip'],
    uti: 'com.pkware.zip-archive',
    extraUtis: ['public.zip-archive'],
    /**
     * Viewer for structure preview (not a full Archive Utility replacement).
     * Password / extract-to-disk remain out of scope until explicit product work.
     */
    tier: 'p1',
    category: 'office',
    glyph: 'package',
    badge: 'ZIP',
    color: '#7A5A3C'
  }
]

export const FILE_ASSOCIATION_CATEGORIES: FileAssociationCategory[] = ['text', 'code', 'data', 'media', 'office']

/** Every UTI a format claims, primary first. */
export function formatUtis(format: Pick<FileAssociationFormat, 'uti' | 'extraUtis'>): string[] {
  return [format.uti, ...(format.extraUtis ?? [])]
}

export function formatById(id: string): FileAssociationFormat | undefined {
  return FILE_ASSOCIATION_FORMATS.find((format) => format.id === id)
}

export function formatIdForExtension(ext: string): string | null {
  const normalized = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`
  return FILE_ASSOCIATION_FORMATS.find((format) => format.extensions.includes(normalized))?.id ?? null
}

export function formatIdForPath(path: string): string | null {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  const dot = name.lastIndexOf('.')
  if (dot < 0) return null
  return formatIdForExtension(name.slice(dot))
}
