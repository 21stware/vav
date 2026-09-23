/**
 * Formats VAV can register as a default opener, plus the document-icon spec
 * Finder / Explorer use when that registration is on.
 *
 * Icon files live at `build/file-icons/{id}.{png,icns,ico}` (see
 * `scripts/generate-file-type-icons.py`). Badge + color here are the in-app
 * counterpart so settings / file trees match the OS glyph.
 */

export interface FileAssociationFormat {
  id: string
  /** Display name */
  label: string
  extensions: string[]
  /** Primary UTI used for Launch Services (macOS) */
  uti: string
  /** P0 = fully supported; P1 = listed but secondary */
  tier: 'p0' | 'p1'
  /** 2–4 letter mark drawn on the document icon. */
  badge: string
  /** Fill color for the document plate (hex). */
  color: string
}

/** Formats from settings-file-associations.rpml. */
export const FILE_ASSOCIATION_FORMATS: FileAssociationFormat[] = [
  {
    id: 'markdown',
    label: 'Markdown',
    extensions: ['.md', '.markdown', '.mdx'],
    uti: 'net.daringfireball.markdown',
    tier: 'p0',
    badge: 'MD',
    color: '#5C4FA3'
  },
  {
    id: 'html',
    label: 'HTML',
    extensions: ['.html', '.htm', '.xhtml'],
    uti: 'public.html',
    tier: 'p0',
    badge: 'HTML',
    color: '#C0562A'
  },
  {
    id: 'plaintext',
    label: 'Plain Text',
    extensions: ['.txt', '.text'],
    uti: 'public.plain-text',
    tier: 'p0',
    badge: 'TXT',
    color: '#5A5A62'
  },
  {
    id: 'json',
    label: 'JSON',
    extensions: ['.json'],
    uti: 'public.json',
    tier: 'p0',
    badge: 'JSON',
    color: '#B07A12'
  },
  {
    id: 'yaml',
    label: 'YAML',
    extensions: ['.yaml', '.yml'],
    uti: 'public.yaml',
    tier: 'p0',
    badge: 'YAML',
    color: '#8A5A72'
  },
  {
    id: 'csv',
    label: 'CSV',
    extensions: ['.csv', '.tsv'],
    uti: 'public.comma-separated-values-text',
    tier: 'p0',
    badge: 'CSV',
    color: '#2F6B48'
  },
  {
    id: 'notebook',
    label: 'Jupyter Notebook',
    extensions: ['.ipynb'],
    uti: 'org.jupyter.ipynb',
    tier: 'p0',
    badge: 'NB',
    color: '#C4781A'
  },
  {
    id: 'swift',
    label: 'Swift Source',
    extensions: ['.swift'],
    uti: 'public.swift-source',
    tier: 'p0',
    badge: 'SW',
    color: '#E04B3A'
  },
  {
    id: 'python',
    label: 'Python Source',
    extensions: ['.py'],
    uti: 'public.python-script',
    tier: 'p0',
    badge: 'PY',
    color: '#2F5A8A'
  },
  {
    id: 'javascript',
    label: 'TypeScript / JavaScript',
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
    uti: 'com.netscape.javascript-source',
    tier: 'p0',
    badge: 'TS',
    color: '#1E6B72'
  },
  {
    id: 'pdf',
    label: 'PDF',
    extensions: ['.pdf'],
    uti: 'com.adobe.pdf',
    tier: 'p1',
    badge: 'PDF',
    color: '#B03A3A'
  },
  {
    id: 'docx',
    label: 'Word Document',
    extensions: ['.docx'],
    uti: 'org.openxmlformats.wordprocessingml.document',
    tier: 'p1',
    badge: 'DOC',
    color: '#2A5280'
  },
  {
    id: 'xlsx',
    label: 'Excel Spreadsheet',
    extensions: ['.xlsx'],
    uti: 'org.openxmlformats.spreadsheetml.sheet',
    tier: 'p1',
    badge: 'XLS',
    color: '#2A6B4A'
  },
  {
    id: 'pptx',
    label: 'PowerPoint Presentation',
    extensions: ['.pptx'],
    uti: 'org.openxmlformats.presentationml.presentation',
    tier: 'p1',
    badge: 'PPT',
    color: '#C04A28'
  },
  {
    id: 'heic',
    label: 'HEIC Image',
    extensions: ['.heic', '.heif'],
    uti: 'public.heic',
    tier: 'p1',
    badge: 'HEIC',
    color: '#7A4A78'
  },
  {
    id: 'zip',
    label: 'ZIP Archive',
    extensions: ['.zip'],
    uti: 'com.pkware.zip-archive',
    /**
     * Viewer for structure preview (not a full Archive Utility replacement).
     * Password / extract-to-disk remain out of scope until explicit product work.
     */
    tier: 'p1',
    badge: 'ZIP',
    color: '#6A5344'
  }
]

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
