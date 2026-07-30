/**
 * PDF → page / line / paragraph blocks via pdf.js text extraction.
 * No iframe: text runs are grouped into lines and paragraphs per page.
 */

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import type { PreviewBlock } from '@shared/previewBlock'
import type { StructuredDocument, StructuredSection } from '@shared/structuredDoc'

const require = createRequire(import.meta.url)

type PdfJs = {
  getDocument: (src: { data: Uint8Array; useSystemFonts?: boolean }) => {
    promise: Promise<PdfDoc>
  }
  GlobalWorkerOptions: { workerSrc: string }
}

type PdfDoc = {
  numPages: number
  getPage: (n: number) => Promise<PdfPage>
}

type PdfPage = {
  getTextContent: () => Promise<{ items: Array<{ str?: string; transform?: number[] }> }>
}

let pdfjsPromise: Promise<PdfJs> | null = null

async function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      // Legacy build works in Electron main without a worker thread.
      const mod = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJs
      try {
        const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')
        mod.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href
      } catch {
        // Worker optional for getTextContent in some builds.
      }
      return mod
    })()
  }
  return pdfjsPromise
}

interface TextItem {
  str: string
  x: number
  y: number
}

function groupLines(items: TextItem[]): string[] {
  if (items.length === 0) return []
  // Sort top-to-bottom, then left-to-right (PDF y increases upward).
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: { y: number; parts: { x: number; str: string }[] }[] = []
  const yTol = 2.5

  for (const item of sorted) {
    if (!item.str.trim()) continue
    const last = lines[lines.length - 1]
    if (last && Math.abs(last.y - item.y) <= yTol) {
      last.parts.push({ x: item.x, str: item.str })
    } else {
      lines.push({ y: item.y, parts: [{ x: item.x, str: item.str }] })
    }
  }

  return lines.map((line) => {
    line.parts.sort((a, b) => a.x - b.x)
    let text = ''
    let prevRight = -Infinity
    for (const p of line.parts) {
      if (text && p.x - prevRight > 1.5) text += ' '
      text += p.str
      prevRight = p.x + p.str.length * 4
    }
    return text.replace(/\s+/g, ' ').trim()
  }).filter(Boolean)
}

/** Merge consecutive short lines into paragraphs when gaps look like soft wraps. */
function linesToParagraphs(lines: string[]): string[] {
  const paras: string[] = []
  let buf = ''
  for (const line of lines) {
    if (!buf) {
      buf = line
      continue
    }
    // Soft wrap heuristic: previous line does not end sentence and next is lowercase-ish.
    const soft =
      !/[.!?。！？:：]$/.test(buf) &&
      line.length > 0 &&
      line[0] === line[0]!.toLowerCase() &&
      buf.length + line.length < 280
    if (soft) {
      buf = `${buf} ${line}`
    } else {
      paras.push(buf)
      buf = line
    }
  }
  if (buf) paras.push(buf)
  return paras
}

export async function parsePdf(
  path: string,
  options?: { maxPages?: number }
): Promise<StructuredDocument> {
  const maxPages = options?.maxPages
  const pdfjs = await loadPdfJs()
  const data = new Uint8Array(await readFile(path))
  const loading = pdfjs.getDocument({ data, useSystemFonts: true })
  const doc = await loading.promise
  const pageCount =
    maxPages != null && Number.isFinite(maxPages)
      ? Math.min(doc.numPages, Math.max(1, maxPages))
      : doc.numPages
  const warnings: string[] = []
  // Soft technical note only when a caller explicitly budgets pages.
  if (maxPages != null && Number.isFinite(maxPages) && doc.numPages > maxPages) {
    warnings.push(`Text index scanned first ${pageCount} of ${doc.numPages} pages`)
  }

  const sections: StructuredSection[] = []
  const rootChildren: PreviewBlock[] = []
  const plainParts: string[] = []
  let line = 1

  for (let p = 1; p <= pageCount; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    const items: TextItem[] = []
    for (const raw of content.items) {
      const str = raw.str ?? ''
      if (!str) continue
      const t = raw.transform ?? [1, 0, 0, 1, 0, 0]
      items.push({ str, x: t[4] ?? 0, y: t[5] ?? 0 })
    }

    const lines = groupLines(items)
    const paragraphs = linesToParagraphs(lines)
    const pageStart = line
    const blocks: PreviewBlock[] = []

    for (let i = 0; i < paragraphs.length; i++) {
      const text = paragraphs[i]!
      plainParts.push(text)
      blocks.push({
        id: `pdf-p${p}-para${i}-L${line}`,
        kind: 'paragraph',
        text,
        label: `Page ${p} · ¶${i + 1}`,
        startLine: line,
        endLine: line
      })
      line += 1
    }

    if (blocks.length === 0) {
      blocks.push({
        id: `pdf-p${p}-empty-L${line}`,
        kind: 'paragraph',
        text: '(no extractable text)',
        label: `Page ${p}`,
        startLine: line,
        endLine: line
      })
      plainParts.push('')
      line += 1
    }

    const pageId = `page-${p}`
    const pageBlock: PreviewBlock = {
      id: pageId,
      kind: 'page',
      text: blocks.map((b) => b.text).join('\n'),
      label: `Page ${p}`,
      startLine: pageStart,
      endLine: Math.max(pageStart, line - 1),
      children: blocks
    }
    rootChildren.push(pageBlock)
    sections.push({
      id: pageId,
      title: `Page ${p}`,
      kind: 'page',
      blocks
    })
  }

  return {
    kind: 'pdf',
    path,
    blocks: rootChildren,
    sections,
    plainText: plainParts.join('\n'),
    warnings: warnings.length ? warnings : undefined
  }
}
