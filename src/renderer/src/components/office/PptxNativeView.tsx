/**
 * PPTX: slide frames from OOXML text (lightweight). Prefer PDF export for
 * pixel-perfect decks; this keeps selectable slide/paragraph structure.
 */

import { useEffect, useState } from 'react'
import JSZip from 'jszip'
import { XMLParser } from 'fast-xml-parser'
import type { PreviewBlock } from '@shared/previewBlock'
import { loadFileBuffer } from '../../lib/officeBinary'
import { useT } from '../../i18n/useT'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  trimValues: false
})

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return []
  return Array.isArray(v) ? v : [v]
}

function collectText(node: unknown): string {
  if (node == null) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (typeof node !== 'object') return ''
  const obj = node as Record<string, unknown>
  if (obj.t != null) {
    const t = obj.t
    if (typeof t === 'string' || typeof t === 'number') return String(t)
    if (t && typeof t === 'object' && '#text' in (t as object)) {
      return String((t as Record<string, unknown>)['#text'])
    }
  }
  let out = ''
  for (const k of Object.keys(obj)) {
    if (k.startsWith('@_')) continue
    out += collectText(obj[k])
  }
  return out
}

function collectParagraphs(node: unknown, out: string[]): void {
  if (node == null || typeof node !== 'object') return
  const obj = node as Record<string, unknown>
  if (obj.p != null) {
    for (const p of asArray(obj.p)) {
      const text = collectText(p).replace(/\s+/g, ' ').trim()
      if (text) out.push(text)
    }
  }
  for (const k of Object.keys(obj)) {
    if (k.startsWith('@_') || k === 'p') continue
    collectParagraphs(obj[k], out)
  }
}

export function PptxNativeView({
  path,
  revision = 0,
  selecting,
  selectedIds,
  onPick
}: {
  path: string
  revision?: number
  selecting: boolean
  selectedIds: string[]
  onPick: (block: PreviewBlock, event: MouseEvent) => void
}): React.JSX.Element {
  const t = useT()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [slides, setSlides] = useState<string[][]>([])
  const [active, setActive] = useState(0)
  const selected = new Set(selectedIds)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const buf = await loadFileBuffer(path)
        if (cancelled) return
        const zip = await JSZip.loadAsync(buf)
        const paths = Object.keys(zip.files)
          .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
          .sort((a, b) => {
            const na = Number(a.match(/slide(\d+)/i)?.[1] ?? 0)
            const nb = Number(b.match(/slide(\d+)/i)?.[1] ?? 0)
            return na - nb
          })
        const next: string[][] = []
        for (const sp of paths) {
          const xml = await zip.file(sp)!.async('string')
          const root = parser.parse(xml)
          const paras: string[] = []
          collectParagraphs(root, paras)
          next.push(paras.length ? paras : ['(empty slide)'])
        }
        setSlides(next)
        setActive(0)
        setLoading(false)
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message || t('preview.loadFailed'))
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [path, revision, t])

  const paras = slides[active] ?? []

  const pick = (id: string, text: string, event: React.MouseEvent, kind: PreviewBlock['kind'] = 'paragraph'): void => {
    event.preventDefault()
    event.stopPropagation()
    onPick(
      {
        id,
        kind,
        text: text.slice(0, 8000),
        label: text.slice(0, 64) || id,
        startLine: 1,
        endLine: 1,
        level: kind === 'heading' ? 1 : undefined
      },
      event.nativeEvent
    )
  }

  return (
    <div className={`office-native-root pptx-root${selecting ? ' selecting' : ''}`}>
      {loading && <div className="office-native-status muted">{t('common.loading')}</div>}
      {error && (
        <div className="office-native-status error">
          <strong>{t('preview.loadFailed')}</strong>
          <div className="muted tiny">{error}</div>
        </div>
      )}
      {!loading && !error && (
        <>
          <nav className="structured-doc-nav">
            <div className="structured-doc-nav-scroll">
              {slides.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  className={`structured-doc-nav-item${i === active ? ' active' : ''}`}
                  onClick={() => setActive(i)}
                >
                  <span className="structured-doc-nav-index">{i + 1}</span>
                  <span className="structured-doc-nav-label">Slide {i + 1}</span>
                </button>
              ))}
            </div>
          </nav>
          <div className="pptx-stage">
            <div
              className={`pptx-slide preview-select-region${selected.has(`pptx-slide-${active}`) ? ' selected' : ''}`}
              data-block-id={`pptx-slide-${active}`}
              onMouseDown={
                selecting
                  ? (e) =>
                      pick(
                        `pptx-slide-${active}`,
                        paras.join('\n'),
                        e,
                        'slide'
                      )
                  : undefined
              }
            >
              {paras.map((text, i) => {
                const id = `pptx-s${active}-p${i}`
                const on = selected.has(id)
                const isTitle = i === 0
                return (
                  <p
                    key={id}
                    className={`pptx-para${isTitle ? ' is-title' : ''} preview-select-region${on ? ' selected' : ''}`}
                    data-block-id={id}
                    onMouseDown={
                      selecting
                        ? (e) => pick(id, text, e, isTitle ? 'heading' : 'paragraph')
                        : undefined
                    }
                  >
                    {text}
                  </p>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
