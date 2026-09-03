import { looksLikeFreeMind, looksLikeOpml } from '../../../shared/mindmap.ts'
import { isLineOrientedPath } from './lineOrientedPath.ts'
import { replaceExt } from './path.ts'

export type FileViewerKindFlags = {
  isMarkdown: boolean
  isNotebook: boolean
  isCsv: boolean
  isSqlite: boolean
  isMindMap: boolean
  isMermaidFile: boolean
  isDotFile: boolean
  isDrawioFile: boolean
  isDiagramCanvas: boolean
  lineOriented: boolean
  isOfficeKind: boolean
  isHtmlKind: boolean
  isHtmlClipKind: boolean
  isZip: boolean
  bodyPad: 'text' | 'none'
  textZoomable: boolean
  isBinaryUnsupported: boolean
  isDirectoryKind: boolean
  isHeic: boolean
  isLegacyOffice: boolean
  formatLockedReadOnly: boolean
  hardForcedReadOnly: boolean
  forcedReadOnly: boolean
}

/** OOXML / PDF canvases that go through the working-copy promote path. */
export function isBinaryOfficeKind(kind: string | null | undefined): boolean {
  return kind === 'docx' || kind === 'xlsx' || kind === 'pptx' || kind === 'pdf'
}

/** Classify the open path so FileViewer does not re-derive format flags inline. */
export function fileViewerKindFlags(opts: {
  filePath: string
  kind?: string | null
  mime?: string | null
  displayText: string
  error?: string | null
  hasInfo: boolean
}): FileViewerKindFlags {
  const { filePath, kind, mime, displayText } = opts
  const textish = kind === 'text' || kind == null
  const isMarkdown =
    /\.(md|markdown|mdx)$/i.test(filePath) || (mime ?? '').includes('markdown')
  const isNotebook = /\.ipynb$/i.test(filePath)
  const isCsv = kind === 'csv' || /\.(csv|tsv)$/i.test(filePath)
  const isSqlite = kind === 'sqlite'
  const isMindMap =
    textish &&
    (/\.opml$/i.test(filePath) ||
      looksLikeOpml(displayText) ||
      (/\.mm$/i.test(filePath) && looksLikeFreeMind(displayText)))
  const isMermaidFile = textish && /\.(mmd|mermaid)$/i.test(filePath)
  const isDotFile = textish && /\.(dot|gv)$/i.test(filePath)
  const isDrawioFile =
    textish &&
    (/\.(drawio|dio)$/i.test(filePath) ||
      (/mxfile/i.test(displayText.slice(0, 400)) && /mxGraphModel|mxCell/i.test(displayText)))
  const isDiagramCanvas = isMindMap || isMermaidFile || isDotFile || isDrawioFile
  const lineOriented =
    !isMarkdown &&
    !isNotebook &&
    !isCsv &&
    !isDiagramCanvas &&
    textish &&
    isLineOrientedPath(filePath, displayText)
  const isOfficeKind = kind === 'pdf' || kind === 'docx' || kind === 'xlsx' || kind === 'pptx'
  const isHtmlKind = kind === 'html'
  const isHtmlClipKind = kind === 'html-clip'
  const isZip = kind === 'zip'
  const isBinaryUnsupported = kind === 'binary'
  const isDirectoryKind = kind === 'directory'
  const isHeic =
    /\.(heic|heif|hif)$/i.test(filePath) || (mime ?? '').toLowerCase().includes('heic')
  const isLegacyOffice =
    /\.(doc|ppt|xls)$/i.test(filePath) && !/\.(docx|pptx|xlsx)$/i.test(filePath)
  const formatLockedReadOnly =
    isHeic || kind === 'pdf' || /\.pdf$/i.test(filePath) || isLegacyOffice
  const hardForcedReadOnly =
    isZip ||
    (isBinaryUnsupported && !isLegacyOffice) ||
    isDirectoryKind ||
    isDrawioFile ||
    isHtmlClipKind
  const bodyPad: 'text' | 'none' =
    isDiagramCanvas ||
    isCsv ||
    isSqlite ||
    isOfficeKind ||
    isHtmlKind ||
    isHtmlClipKind ||
    isZip ||
    kind === 'image' ||
    kind === 'audio' ||
    kind === 'video' ||
    kind === 'binary'
      ? 'none'
      : 'text'
  const textZoomable =
    opts.hasInfo &&
    !opts.error &&
    (isCsv || isSqlite || kind === 'xlsx' || (kind === 'text' && !isDiagramCanvas))
  return {
    isMarkdown,
    isNotebook,
    isCsv,
    isSqlite,
    isMindMap,
    isMermaidFile,
    isDotFile,
    isDrawioFile,
    isDiagramCanvas,
    lineOriented,
    isOfficeKind,
    isHtmlKind,
    isHtmlClipKind,
    isZip,
    bodyPad,
    textZoomable,
    isBinaryUnsupported,
    isDirectoryKind,
    isHeic,
    isLegacyOffice,
    formatLockedReadOnly,
    hardForcedReadOnly,
    forcedReadOnly: hardForcedReadOnly || formatLockedReadOnly
  }
}

export type ConvertEditProfile = {
  formatKey: 'jpeg' | 'docx' | 'xlsx' | 'pptx' | 'pdf'
  suggestedPath: string
  sourcePath: string
}

/** Convert + Save As profile when the open format cannot be written in place. */
export function convertEditProfileFor(
  filePath: string,
  opts: {
    kind?: string | null
    contentPath?: string | null
    isHeic: boolean
    isLegacyOffice: boolean
  }
): ConvertEditProfile | null {
  const source = opts.contentPath?.trim() || filePath
  if (opts.isHeic) {
    return { formatKey: 'jpeg', suggestedPath: replaceExt(filePath, '.jpg'), sourcePath: source }
  }
  if (opts.kind === 'docx' || (/\.docx$/i.test(filePath) && !opts.isLegacyOffice)) {
    return { formatKey: 'docx', suggestedPath: replaceExt(filePath, '.docx'), sourcePath: source }
  }
  if (opts.kind === 'xlsx' || /\.xlsx$/i.test(filePath)) {
    return { formatKey: 'xlsx', suggestedPath: replaceExt(filePath, '.xlsx'), sourcePath: source }
  }
  if (opts.kind === 'pptx' || /\.pptx$/i.test(filePath)) {
    return { formatKey: 'pptx', suggestedPath: replaceExt(filePath, '.pptx'), sourcePath: source }
  }
  if (opts.kind === 'pdf' || /\.pdf$/i.test(filePath)) {
    return { formatKey: 'pdf', suggestedPath: replaceExt(filePath, '.pdf'), sourcePath: filePath }
  }
  if (/\.doc$/i.test(filePath) && !/\.docx$/i.test(filePath)) {
    return { formatKey: 'docx', suggestedPath: replaceExt(filePath, '.docx'), sourcePath: source }
  }
  if (/\.xls$/i.test(filePath) && !/\.xlsx$/i.test(filePath)) {
    return { formatKey: 'xlsx', suggestedPath: replaceExt(filePath, '.xlsx'), sourcePath: source }
  }
  if (/\.ppt$/i.test(filePath) && !/\.pptx$/i.test(filePath)) {
    return { formatKey: 'pptx', suggestedPath: replaceExt(filePath, '.pptx'), sourcePath: source }
  }
  return null
}

/** Kinds that support Agent block pick (plus media when a canvas src exists). */
export function isPreviewKindSelectable(
  kind: string | null | undefined,
  hasMediaSrc: boolean
): boolean {
  return (
    kind === 'text' ||
    kind === 'csv' ||
    kind === 'sqlite' ||
    kind === 'pdf' ||
    kind === 'docx' ||
    kind === 'xlsx' ||
    kind === 'pptx' ||
    kind === 'html' ||
    kind === 'zip' ||
    hasMediaSrc
  )
}
