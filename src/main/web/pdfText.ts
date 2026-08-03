/**
 * Extract plain text from a PDF buffer using the same pdf.js legacy path as
 * local document indexing (no worker required in Electron main).
 */

import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)

type PdfJs = {
  getDocument: (src: { data: Uint8Array; useSystemFonts?: boolean }) => {
    promise: Promise<{
      numPages: number
      getPage: (n: number) => Promise<{
        getTextContent: () => Promise<{ items: Array<{ str?: string; transform?: number[] }> }>
      }>
    }>
  }
  GlobalWorkerOptions: { workerSrc: string }
}

let pdfjsPromise: Promise<PdfJs> | null = null

async function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const mod = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJs
      try {
        const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')
        mod.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href
      } catch {
        /* worker optional for text extraction */
      }
      return mod
    })()
  }
  return pdfjsPromise
}

export async function extractPdfTextFromBuffer(
  data: Buffer | Uint8Array,
  options?: { maxPages?: number }
): Promise<{ text: string; pageCount: number; scannedPages: number }> {
  const pdfjs = await loadPdfJs()
  const bytes = data instanceof Buffer ? new Uint8Array(data) : data
  const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: true }).promise
  const maxPages = options?.maxPages
  const scanned =
    maxPages != null && Number.isFinite(maxPages)
      ? Math.min(doc.numPages, Math.max(1, Math.floor(maxPages)))
      : doc.numPages

  const parts: string[] = []
  for (let p = 1; p <= scanned; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    const items = content.items
      .map((it) => ({
        str: it.str ?? '',
        x: it.transform?.[4] ?? 0,
        y: it.transform?.[5] ?? 0
      }))
      .filter((it) => it.str.trim())

    // Top-to-bottom, left-to-right
    items.sort((a, b) => b.y - a.y || a.x - b.x)
    const lines: { y: number; parts: { x: number; str: string }[] }[] = []
    const yTol = 2.5
    for (const item of items) {
      const last = lines[lines.length - 1]
      if (last && Math.abs(last.y - item.y) <= yTol) {
        last.parts.push({ x: item.x, str: item.str })
      } else {
        lines.push({ y: item.y, parts: [{ x: item.x, str: item.str }] })
      }
    }
    const pageText = lines
      .map((line) => {
        line.parts.sort((a, b) => a.x - b.x)
        return line.parts.map((p) => p.str).join(' ').replace(/\s+/g, ' ').trim()
      })
      .filter(Boolean)
      .join('\n')
    if (pageText) {
      parts.push(`--- Page ${p} ---\n${pageText}`)
    }
  }

  return {
    text: parts.join('\n\n').trim(),
    pageCount: doc.numPages,
    scannedPages: scanned
  }
}
