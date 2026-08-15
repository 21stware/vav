/**
 * DOCX via docx-preview. Selection: single capture listener, leaf targets only.
 * Layout is CSS-only: the parsed page is measured once, then scaled to whatever
 * fit-to-width or the user's pinch asks for (see {@link useDocZoom}).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { renderAsync } from 'docx-preview'
import type { PreviewBlock } from '@shared/previewBlock'
import { loadFileBuffer } from '../../lib/officeBinary'
import { attachDomPick, updateDomPick } from './pickFromDom'
import { useT } from '../../i18n/useT'
import { PagePager } from './PagePager'
import { DocZoomControls, DOC_ZOOM_STEP } from './DocZoomControls'
import { useDocZoom } from './useDocZoom'
import { useDocumentPageIndex } from './useDocumentPageIndex'
import { writeDocZoom } from '../../lib/selectionChrome'

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

type DocxNatural = { pageWidth: number; height: number }

/** Wrap the docx-preview output in a frame whose box is the *visual* page. */
function ensureFitFrame(host: HTMLElement): HTMLElement | null {
  // className: 'docx-native' → wrapper is `.docx-native-wrapper` (not `.docx-wrapper`).
  const wrapper = host.querySelector(
    '.docx-native-wrapper, .docx-wrapper'
  ) as HTMLElement | null
  if (!wrapper) return null
  const parent = wrapper.parentElement
  if (parent?.classList.contains('docx-fit-frame')) return parent
  const frame = document.createElement('div')
  frame.className = 'docx-fit-frame'
  wrapper.replaceWith(frame)
  frame.appendChild(wrapper)
  return frame
}

/**
 * Natural (100%) page width + document height, measured once per render at
 * transform: none. Everything after that is arithmetic on these two numbers.
 */
function measureDocxNatural(host: HTMLElement): DocxNatural | null {
  const wrapper = host.querySelector(
    '.docx-native-wrapper, .docx-wrapper'
  ) as HTMLElement | null
  if (!wrapper) return null
  wrapper.style.transform = 'none'
  let pageWidth = 0
  wrapper
    .querySelectorAll<HTMLElement>('section.docx-native, section.docx, .docx')
    .forEach((page) => {
      pageWidth = Math.max(pageWidth, page.offsetWidth || page.scrollWidth || 0)
    })
  if (pageWidth < 40) pageWidth = wrapper.scrollWidth || 816
  const height = wrapper.scrollHeight || 0
  // Refuse to lock in a collapsed measurement — the host may still be 0×0.
  if (!(pageWidth > 40) || !(height > 40)) return null
  return { pageWidth, height }
}

/** CSS-only scale. Never re-parses DOCX. */
function applyDocxScale(host: HTMLElement, natural: DocxNatural, scale: number): void {
  const frame = ensureFitFrame(host)
  const wrapper = frame?.firstElementChild as HTMLElement | null
  if (!frame || !wrapper) return

  wrapper.dataset.chromeSubject = 'true'
  wrapper.style.transformOrigin = 'top center'
  wrapper.style.transform = Math.abs(scale - 1) < 0.004 ? 'none' : `scale(${scale})`
  writeDocZoom(frame, scale)

  // Frame box tracks the scaled page so the stage can centre it and the
  // scrollport knows the real pan bounds. Floor, never ceil: at fit the page is
  // exactly the stage's usable width, and a rounded-up pixel adds a scrollbar.
  const visW = Math.floor(natural.pageWidth * scale)
  const visH = Math.floor(natural.height * scale)
  frame.style.width = `${visW}px`
  frame.style.minWidth = `${visW}px`
  frame.style.maxWidth = 'none'
  frame.style.height = `${visH}px`
  frame.style.minHeight = `${visH}px`
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
  const frameRef = useRef<HTMLElement | null>(null)
  const styleRef = useRef<HTMLDivElement>(null)
  const naturalRef = useRef<DocxNatural | null>(null)
  const [naturalWidth, setNaturalWidth] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick

  const applyScale = useCallback((scale: number): void => {
    const body = bodyRef.current
    const natural = naturalRef.current
    if (!body || !natural) return
    applyDocxScale(body, natural, scale)
    frameRef.current = body.querySelector<HTMLElement>('.docx-fit-frame')
  }, [])

  const zoom = useDocZoom({
    stageRef: bodyRef,
    contentRef: frameRef,
    naturalWidth,
    apply: applyScale,
    enabled: ready && !error
  })

  // docx-preview emits one <section> per page when breakPages is true.
  const pageIndex = useDocumentPageIndex({
    scrollRef: bodyRef,
    pageSelector: 'section.docx-native, section.docx, .docx-native-wrapper > section, .docx-wrapper > section',
    enabled: ready && !error
  })

  useEffect(() => {
    let cancelled = false
    let dispose: (() => void) | undefined
    let measureRaf = 0
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
        const buffer = await loadFileBuffer(path, revision)
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

        // Measure at 100% before any scale lands. A host that is still 0×0
        // (background tab, staged open) reports nothing — retry next frame.
        const measure = (attempt: number): void => {
          if (cancelled) return
          const natural = measureDocxNatural(body)
          if (!natural) {
            if (attempt < 8) measureRaf = requestAnimationFrame(() => measure(attempt + 1))
            return
          }
          naturalRef.current = natural
          frameRef.current = ensureFitFrame(body)
          setNaturalWidth(natural.pageWidth)
          // A rewrite at the same page width changes no state, but the DOM
          // carrying the scale is new — re-assert it.
          zoom.refresh()
        }
        measure(0)

        dispose = attachDomPick(body, {
          selecting,
          selectedIds,
          onPick: pick,
          idPrefix: 'docx',
          selector: DOCX_SELECTOR
        })

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
      if (measureRaf) cancelAnimationFrame(measureRaf)
      dispose?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, revision])

  // A different file always opens fitted; an agent rewrite keeps the zoom.
  useEffect(() => {
    naturalRef.current = null
    setNaturalWidth(0)
    zoom.fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

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
      <PagePager
        current={pageIndex.current}
        total={pageIndex.total}
        onPrev={pageIndex.prev}
        onNext={pageIndex.next}
        disabled={!ready || !!error}
      />
      <DocZoomControls
        scale={zoom.scale}
        atFit={zoom.atFit}
        onZoomIn={() => zoom.zoomBy(DOC_ZOOM_STEP)}
        onZoomOut={() => zoom.zoomBy(1 / DOC_ZOOM_STEP)}
        onFit={zoom.actualSize}
        disabled={!ready || !!error}
      />
    </div>
  )
}
