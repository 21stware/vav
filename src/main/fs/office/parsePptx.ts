/**
 * PPTX → slide / paragraph blocks via OOXML slide XMLs.
 */

import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { XMLParser } from 'fast-xml-parser'
import type { PreviewBlock } from '@shared/previewBlock'
import type { StructuredDocument, StructuredSection } from '@shared/structuredDoc'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  trimValues: false
})

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

function collectText(node: unknown): string {
  if (node == null) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (typeof node !== 'object') return ''
  const obj = node as Record<string, unknown>
  // a:t text runs
  if (obj.t != null) {
    const t = obj.t
    if (typeof t === 'string' || typeof t === 'number') return String(t)
    if (t && typeof t === 'object') {
      const rec = t as Record<string, unknown>
      if (rec['#text'] != null) return String(rec['#text'])
    }
  }
  let out = ''
  for (const key of Object.keys(obj)) {
    if (key.startsWith('@_')) continue
    out += collectText(obj[key])
  }
  return out
}

/** Collect a:p paragraph nodes under a slide. */
function collectParagraphs(node: unknown, out: string[]): void {
  if (node == null || typeof node !== 'object') return
  const obj = node as Record<string, unknown>
  if (obj.p != null) {
    for (const p of asArray(obj.p)) {
      const text = collectText(p).replace(/\s+/g, ' ').trim()
      if (text) out.push(text)
    }
  }
  for (const key of Object.keys(obj)) {
    if (key.startsWith('@_') || key === 'p') continue
    collectParagraphs(obj[key], out)
  }
}

export async function parsePptx(path: string): Promise<StructuredDocument> {
  const buf = await readFile(path)
  const zip = await JSZip.loadAsync(buf)

  const slidePaths = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)/i)?.[1] ?? 0)
      const nb = Number(b.match(/slide(\d+)/i)?.[1] ?? 0)
      return na - nb
    })

  if (slidePaths.length === 0) {
    throw new Error('Invalid PPTX: no slides found')
  }

  const sections: StructuredSection[] = []
  const rootChildren: PreviewBlock[] = []
  const plainParts: string[] = []
  let line = 1

  for (let si = 0; si < slidePaths.length; si++) {
    const slidePath = slidePaths[si]!
    const xml = await zip.file(slidePath)!.async('string')
    const root = parser.parse(xml) as Record<string, unknown>
    const paras: string[] = []
    collectParagraphs(root, paras)

    const slideNum = si + 1
    const slideStart = line
    const blocks: PreviewBlock[] = []

    for (let pi = 0; pi < paras.length; pi++) {
      const text = paras[pi]!
      plainParts.push(text)
      const isTitle = pi === 0
      blocks.push({
        id: `pptx-s${slideNum}-p${pi}-L${line}`,
        kind: isTitle ? 'heading' : 'paragraph',
        text,
        level: isTitle ? 1 : undefined,
        label: isTitle ? `Slide ${slideNum} · title` : `Slide ${slideNum} · p${pi + 1}`,
        startLine: line,
        endLine: line
      })
      line += 1
    }

    if (blocks.length === 0) {
      blocks.push({
        id: `pptx-s${slideNum}-empty-L${line}`,
        kind: 'paragraph',
        text: '(empty slide)',
        label: `Slide ${slideNum}`,
        startLine: line,
        endLine: line
      })
      plainParts.push('')
      line += 1
    }

    const slideId = `slide-${slideNum}`
    const slideBlock: PreviewBlock = {
      id: slideId,
      kind: 'slide',
      text: blocks.map((b) => b.text).join('\n'),
      label: `Slide ${slideNum}`,
      startLine: slideStart,
      endLine: Math.max(slideStart, line - 1),
      children: blocks
    }
    rootChildren.push(slideBlock)
    sections.push({
      id: slideId,
      title: `Slide ${slideNum}`,
      kind: 'slide',
      blocks
    })
  }

  return {
    kind: 'pptx',
    path,
    blocks: rootChildren,
    sections,
    plainText: plainParts.join('\n')
  }
}
