import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { handleClickPickMouseDown, type ClickPickPointer } from '../../lib/clickPick'
import { writeDocZoom } from '../../lib/selectionChrome'
import { DocZoomControls, DOC_ZOOM_STEP } from '../office/DocZoomControls'
import { useDocZoom } from '../office/useDocZoom'

export function readImageNatural(img: HTMLImageElement | null): { width: number; height: number } | null {
  if (!img) return null
  const width = img.naturalWidth
  const height = img.naturalHeight
  if (!(width > 0) || !(height > 0)) return null
  return { width, height }
}

/**
 * Image stage with the same zoom feel as the document viewers: opens contained
 * (whole picture, never blown past 100%), pinches up to 4×, and pans by real
 * scrolling so the photo can never be flung off into empty canvas. While it is
 * still contained the stage keeps re-fitting, so opening the agent panel
 * reflows the picture; once the reader has zoomed in, the panel just covers
 * part of it instead of yanking the view.
 */
export function ImageZoomStage({
  src,
  alt,
  selecting,
  selected,
  onSelect
}: {
  src: string
  alt: string
  selecting: boolean
  selected: boolean
  onSelect: (event?: React.MouseEvent | ClickPickPointer | null) => void
}): React.JSX.Element {
  const stageRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [natural, setNatural] = useState({ width: 0, height: 0 })
  const naturalRef = useRef(natural)
  naturalRef.current = natural

  const apply = useCallback((scale: number): void => {
    const content = contentRef.current
    const img = imgRef.current
    const { width, height } = naturalRef.current
    if (!content || !img || !(width > 0)) return
    // Wrapper is the scroll box. The bitmap stays at natural CSS px and is
    // GPU-scaled — resizing <img> width/height every pinch tick re-decodes
    // a multi-megapixel PNG and drops frames.
    const w = Math.max(1, Math.floor(width * scale))
    const h = Math.max(1, Math.floor(height * scale))
    content.style.width = `${w}px`
    content.style.height = `${h}px`
    content.style.minWidth = `${w}px`
    content.style.minHeight = `${h}px`
    writeDocZoom(content, 1)
    if (img.dataset.zoomSized !== '1') {
      img.style.width = `${width}px`
      img.style.height = `${height}px`
      img.style.transformOrigin = '0 0'
      img.dataset.zoomSized = '1'
    }
    img.style.transform = `scale(${scale})`
  }, [])

  const zoom = useDocZoom({
    stageRef,
    contentRef,
    naturalWidth: natural.width,
    naturalHeight: natural.height,
    apply,
    enabled: natural.width > 0
  })

  // Cached images often skip `onLoad`. Read natural size from the element
  // itself so fit/readout are not left sitting at the 100% placeholder.
  useEffect(() => {
    const measured = readImageNatural(imgRef.current)
    if (measured) setNatural(measured)
  }, [src])

  const zoomable = natural.width > 0
  return (
    <>
      <div
        className="preview-media-stage image-zoom-stage"
        ref={stageRef}
        data-zoomable={zoomable ? 'true' : 'false'}
      >
        <div
          ref={contentRef}
          className={`image-zoom-content${
            selecting ? ` preview-select-region media-pick-frame${selected ? ' selected' : ''}` : ''
          }`}
          onMouseDown={(event) => {
            if (!selecting) return
            handleClickPickMouseDown(event, () => onSelect(null))
          }}
        >
          <img
            ref={imgRef}
            className="file-viewer-media"
            src={src}
            alt={alt}
            draggable={false}
            onLoad={(event) => {
              const measured = readImageNatural(event.currentTarget)
              if (measured) setNatural(measured)
            }}
          />
        </div>
      </div>
      {/* Outside the stage: chrome inside a scrollport scrolls away with it. */}
      <DocZoomControls
        scale={zoom.scale}
        atFit={zoom.atFit}
        onZoomIn={() => zoom.zoomBy(DOC_ZOOM_STEP)}
        onZoomOut={() => zoom.zoomBy(1 / DOC_ZOOM_STEP)}
        onFit={zoom.actualSize}
        resetKey="preview.actualSize"
        disabled={!zoomable}
      />
    </>
  )
}

/**
 * Centers media in the preview stage.
 *
 * Pick outline is a wrapper around media — never cloneElement onto <audio>/
 * <video>. Assigning pick classes (display:flex) onto native controls collapsed
 * the player to an empty stage (MP3 looked blank).
 */
export function MediaSelectFrame({
  selecting,
  selected,
  onSelect,
  children
}: {
  selecting: boolean
  selected: boolean
  onSelect: (event?: React.MouseEvent | ClickPickPointer | null) => void
  children: ReactNode
}): React.JSX.Element {
  if (!selecting) {
    return <div className="preview-media-stage">{children}</div>
  }
  return (
    <div className="preview-media-stage">
      <div
        className={`preview-select-region media-pick-frame${selected ? ' selected' : ''}`}
        onMouseDown={(event) => {
          // Native seek/play/volume must work — don't steal those clicks.
          const tag = (event.target as HTMLElement | null)?.tagName
          if (tag === 'AUDIO' || tag === 'VIDEO') return
          handleClickPickMouseDown(event, () => onSelect(null))
        }}
      >
        {children}
      </div>
    </div>
  )
}
