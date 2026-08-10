/**
 * DOCX via docx-preview. Selection: single capture listener, leaf targets only.
 * Fit-to-width via CSS transform when the preview pane is narrower/wider than a page.
 */

import { useEffect, useRef, useState } from 'react'
import { renderAsync } from 'docx-preview'
import type { PreviewBlock } from '@shared/previewBlock'
import { loadFileBuffer } from '../../lib/officeBinary'
import { docMeasureMinPx, docMeasurePx, stableContentWidth } from '../../lib/docMeasure'
import { attachDomPick, updateDomPick } from './pickFromDom'
import { useT } from '../../i18n/useT'

const DOCX_SELECTOR = [
  '.docx-native p',
  '.docx-native h1',
  '.docx-native h2',
  '.docx-native h3',
  '.docx-native h4',
  '.docx-native h5',
  '.docx-native h6',
  '.docx-native li',
  '.docx-native td',
  '.docx-native th'
].join(',')

/**
 * CSS-only fit. Never re-parses DOCX.
 * Caches natural page width so resize only does arithmetic + style writes.
 */
function fitDocxToHost(host: HTMLElement): void {
  // className: 'docx-native' → wrapper is `.docx-native-wrapper` (not `.docx-wrapper`).
  const wrapper = host.querySelector(
    '.docx-native-wrapper, .docx-wrapper'
  ) as HTMLElement | null
  if (!wrapper) return

  let frame = wrapper.parentElement
  if (!frame?.classList.contains('docx-fit-frame')) {
    frame = document.createElement('div')
    frame.className = 'docx-fit-frame'
    wrapper.replaceWith(frame)
    frame.appendChild(wrapper)
  }

  // Host not laid out yet (or was staged at 0×0) — drop stale cache and bail;
  // ResizeObserver will re-fit once the scrollport has a real width.
  if (host.clientWidth < 40) {
    delete wrapper.dataset.naturalPageW
    delete wrapper.dataset.naturalH
    delete wrapper.dataset.docxScale
    return
  }

  // Cache natural metrics once (or when content changes).
  let pageW = Number(wrapper.dataset.naturalPageW || 0)
  let naturalH = Number(wrapper.dataset.naturalH || 0)
  if (!(pageW > 40) || !(naturalH > 40)) {
    wrapper.style.transform = 'none'
    const pages = wrapper.querySelectorAll<HTMLElement>(
      'section.docx-native, section.docx, .docx'
    )
    pageW = 0
    pages.forEach((p) => {
      pageW = Math.max(pageW, p.offsetWidth || p.scrollWidth || 0)
    })
    if (pageW < 40) pageW = wrapper.scrollWidth || 816
    naturalH = wrapper.scrollHeight || 1
    // Refuse to lock in a collapsed measurement.
    if (!(pageW > 40) || !(naturalH > 40)) return
    wrapper.dataset.naturalPageW = String(pageW)
    wrapper.dataset.naturalH = String(naturalH)
  }

  // Stable paper width (min…max). Pane size only scrolls — never reflows scale.
  const target = stableContentWidth(pageW, docMeasureMinPx(host), docMeasurePx(host))
  const scale = Math.min(2.75, Math.max(0.35, target / pageW))
  const prev = Number(wrapper.dataset.docxScale || 0)
  // Skip no-op style thrash during sub-pixel ResizeObserver noise.
  if (prev && Math.abs(prev - scale) < 0.008) return

  wrapper.style.transformOrigin = 'top center'
  wrapper.style.transform = Math.abs(scale - 1) < 0.004 ? 'none' : `scale(${scale})`
  wrapper.dataset.docxScale = String(scale)

  // Visual width tracks the scaled page so the stage centers like PDF frames.
  // No max-width:100% — narrower stages scroll horizontally instead of squashing.
  const visW = Math.ceil(pageW * scale)
  frame.style.width = `${visW}px`
  frame.style.maxWidth = 'none'
  frame.style.minWidth = `${visW}px`
  frame.style.height = `${Math.ceil(naturalH * scale)}px`
  frame.style.minHeight = `${Math.ceil(naturalH * scale)}px`
  frame.style.margin = '0 auto'
}

export function DocxNativeView({
  path,
  revision = 0,
  selecting,
  selectedIds,
  onPick,
  onReady
}: {
  path: string
  /** Bump when the file is rewritten on disk so the canvas reloads. */
  revision?: number
  selecting: boolean
  selectedIds: string[]
  onPick: (block: PreviewBlock, event: MouseEvent) => void
  onReady?: () => void
}): React.JSX.Element {
  const t = useT()
  const bodyRef = useRef<HTMLDivElement>(null)
  const styleRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick

  useEffect(() => {
    let cancelled = false
    let dispose: (() => void) | undefined
    let ro: ResizeObserver | null = null
    let fitRaf = 0
    const body = bodyRef.current
    const styleHost = styleRef.current
    if (!body) return

    // Keep the previous canvas painted until the next render is ready —
    // clearing first was a full-page white flash on every agent rewrite.
    const hadContent = body.childNodes.length > 0
    if (!hadContent) setLoading(true)
    setError(null)

    const pick = (block: PreviewBlock, event: MouseEvent): void => {
      onPickRef.current(block, event)
    }

    void (async () => {
      try {
        const buffer = await loadFileBuffer(path)
        if (cancelled) return
        const staging = document.createElement('div')
        await renderAsync(buffer, staging, styleHost ?? undefined, {
          className: 'docx-native',
          inWrapper: true,
          breakPages: true,
          renderHeaders: true,
          renderFooters: true,
          ignoreWidth: false,
          ignoreHeight: false,
          useBase64URL: true
        })
        if (cancelled) return

        // Library default injects gray stage on the wrapper — strip it explicitly
        // (CSS targets .docx-native-wrapper; also clear any inline leftovers).
        const wrapper = staging.querySelector(
          '.docx-native-wrapper, .docx-wrapper'
        ) as HTMLElement | null
        if (wrapper) {
          wrapper.style.background = 'transparent'
          wrapper.style.padding = '0'
          wrapper.style.boxShadow = 'none'
        }

        body.replaceChildren(...Array.from(staging.childNodes))
        fitDocxToHost(body)

        dispose = attachDomPick(body, {
          selecting,
          selectedIds,
          onPick: pick,
          idPrefix: 'docx',
          selector: DOCX_SELECTOR
        })

        if (typeof ResizeObserver !== 'undefined') {
          // rAF-throttle: CSS-only, never re-render DOCX on resize.
          ro = new ResizeObserver(() => {
            if (fitRaf) return
            fitRaf = requestAnimationFrame(() => {
              fitRaf = 0
              if (cancelled) return
              fitDocxToHost(body)
            })
          })
          ro.observe(body)
        }

        setLoading(false)
        setReady(true)
        onReady?.()
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message || t('preview.loadFailed'))
          setLoading(false)
          onReady?.()
          setReady(false)
        }
      }
    })()

    return () => {
      cancelled = true
      if (fitRaf) cancelAnimationFrame(fitRaf)
      ro?.disconnect()
      dispose?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, revision])

  useEffect(() => {
    if (!ready) return
    updateDomPick(bodyRef.current, {
      selecting,
      selectedIds,
      onPick: (block, event) => onPickRef.current(block, event)
    })
  }, [selecting, selectedIds, ready])

  return (
    <div className={`office-native-root docx-root${selecting ? ' selecting' : ''}`}>
      <div ref={styleRef} className="docx-style-host" hidden />
      {loading && <div className="office-native-status muted">{t('common.loading')}</div>}
      {error && (
        <div className="office-native-status error">
          <strong>{t('preview.loadFailed')}</strong>
          <div className="muted tiny">{error}</div>
        </div>
      )}
      <div ref={bodyRef} className="docx-body-host" data-pick-root="true" />
    </div>
  )
}
