import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppearance } from './lib/appearance'
import { installDefaultContextMenu, showMenu } from './lib/nativeMenu'
import { installSettingsBridge, useSessionStore } from './state/sessionStore'
import { HtmlClipFrame } from './components/HtmlClipFrame'
import { DiagramFileView, type DiagramFileKind } from './components/diagram/DiagramFileView'
import { useDocZoom } from './components/office/useDocZoom'
import { writeDocZoom } from './lib/selectionChrome'
import { localFileStreamUrl } from '@shared/localFileUrl'
import {
  inferDiagramKind,
  inferOverlayKind,
  type OverlayKind,
  type OverlayPayload
} from '@shared/overlayOpen'
import { tt } from './i18n/useT'

type OverlayMode = 'loading' | 'app' | 'image' | 'diagram' | 'error'

function fileBase(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || path
}

const IMAGE_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.bmp',
  '.avif',
  '.heic',
  '.heif',
  '.tif',
  '.tiff'
])

function looksLikeImagePath(path: string): boolean {
  const base = fileBase(path).toLowerCase()
  const dot = base.lastIndexOf('.')
  if (dot < 0) return false
  return IMAGE_EXTS.has(base.slice(dot))
}

function diagramKindFromPath(path: string): DiagramFileKind | null {
  const base = fileBase(path).toLowerCase()
  if (base.endsWith('.mmd') || base.endsWith('.mermaid')) return 'mermaid'
  if (base.endsWith('.dot') || base.endsWith('.gv')) return 'graphviz'
  if (
    base.endsWith('.vl.json') ||
    base.endsWith('.vg.json') ||
    base.endsWith('.vegalite.json')
  ) {
    return 'vegalite'
  }
  return null
}

function fitOverlayWindow(nw: number, nh: number): void {
  if (!(nw > 0) || !(nh > 0)) return
  const maxW = Math.min(960, window.screen.availWidth - 80)
  const maxH = Math.min(800, window.screen.availHeight - 80)
  const scale = Math.min(1, maxW / nw, maxH / nh)
  const w = Math.max(280, Math.round(nw * scale))
  const h = Math.max(200, Math.round(nh * scale))
  const cx = window.screenX + window.outerWidth / 2
  const cy = window.screenY + window.outerHeight / 2
  window.resizeTo(w, h)
  window.moveTo(Math.round(cx - w / 2), Math.round(cy - h / 2))
}

async function bytesFromUrl(src: string): Promise<{ base64: string; mime: string } | null> {
  try {
    if (src.startsWith('data:')) {
      const match = /^data:([^;]+);base64,(.+)$/i.exec(src)
      if (!match) return null
      return { mime: match[1] || 'image/png', base64: match[2]! }
    }
    const res = await fetch(src)
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
    return {
      mime: res.headers.get('content-type') || 'image/png',
      base64: btoa(binary)
    }
  } catch {
    return null
  }
}

function extFromMime(mime: string): string {
  const type = mime.toLowerCase()
  if (type.includes('jpeg')) return 'jpg'
  if (type.includes('webp')) return 'webp'
  if (type.includes('gif')) return 'gif'
  if (type.includes('svg')) return 'svg'
  if (type.includes('avif')) return 'avif'
  return 'png'
}

async function copyImageSrc(src: string): Promise<boolean> {
  const packed = await bytesFromUrl(src)
  if (packed) {
    const api = window.vav?.conversations?.copyImageToClipboard
    if (typeof api === 'function') {
      const result = await api(packed.base64)
      if (result?.ok) return true
    }
  }
  try {
    const img = new Image()
    img.src = src
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return false
    ctx.drawImage(img, 0, 0)
    const dataUrl = canvas.toDataURL('image/png')
    const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
    const result = await window.vav.conversations.copyImageToClipboard(b64)
    return result?.ok === true
  } catch {
    return false
  }
}

async function saveImageSrc(src: string, filename: string): Promise<void> {
  const packed = await bytesFromUrl(src)
  if (!packed) return
  const name = filename.includes('.') ? filename : `${filename}.${extFromMime(packed.mime)}`
  const dest = await window.vav.files.saveAs(name, '')
  if (!dest.ok) return
  await window.vav.files.writeBinary(dest.path, packed.base64)
}

function OverlayImage({
  src,
  alt,
  filename
}: {
  src: string
  alt: string
  filename: string
}): React.JSX.Element {
  const stageRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const sizedRef = useRef(false)
  const [natural, setNatural] = useState({ width: 0, height: 0 })
  const naturalRef = useRef(natural)
  naturalRef.current = natural

  const apply = useCallback((scale: number): void => {
    const content = contentRef.current
    const img = imgRef.current
    const { width, height } = naturalRef.current
    if (!content || !img || !(width > 0)) return
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
      img.style.maxWidth = 'none'
      img.style.maxHeight = 'none'
      img.style.transformOrigin = '0 0'
      img.dataset.zoomSized = '1'
    }
    img.style.transform = `scale(${scale})`
  }, [])

  useDocZoom({
    stageRef,
    contentRef,
    naturalWidth: natural.width,
    naturalHeight: natural.height,
    apply,
    enabled: natural.width > 0
  })

  const adoptSize = useCallback((width: number, height: number): void => {
    if (!(width > 0) || !(height > 0)) return
    setNatural({ width, height })
    if (sizedRef.current) return
    sizedRef.current = true
    fitOverlayWindow(width, height)
  }, [])

  useEffect(() => {
    const img = imgRef.current
    if (img && img.naturalWidth > 0) adoptSize(img.naturalWidth, img.naturalHeight)
  }, [adoptSize, src])

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onContext = (event: MouseEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      void showMenu(
        [
          {
            label: tt('md.action.copyImage'),
            onSelect: () => {
              void copyImageSrc(src)
            }
          },
          {
            label: tt('md.action.saveImage'),
            onSelect: () => {
              void saveImageSrc(src, filename)
            }
          }
        ],
        { x: event.clientX, y: event.clientY }
      )
    }
    el.addEventListener('contextmenu', onContext, true)
    return () => el.removeEventListener('contextmenu', onContext, true)
  }, [filename, src])

  return (
    <div
      className="app-clip-image"
      ref={stageRef}
      data-zoomable={natural.width > 0 ? 'true' : 'false'}
    >
      <div ref={contentRef} className="app-clip-image-frame">
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          draggable={false}
          onLoad={(event) => {
            const el = event.currentTarget
            adoptSize(el.naturalWidth, el.naturalHeight)
          }}
        />
      </div>
    </div>
  )
}

type OverlayView = {
  path: string
  kind?: OverlayKind
  diagramKind?: DiagramFileKind
  filename?: string
  text: string | null
  mediaSrc: string | null
}

function viewFromPayload(payload: OverlayPayload): OverlayView {
  const path = payload.path ?? ''
  const kind = payload.kind ?? inferOverlayKind(path)
  const diagramKind = payload.diagramKind ?? inferDiagramKind(path) ?? undefined
  const mediaSrc =
    payload.mediaSrc ??
    (kind === 'image' && path ? localFileStreamUrl(path) : null)
  return {
    path,
    kind,
    diagramKind: diagramKind ?? undefined,
    filename: payload.filename,
    text: payload.text ?? null,
    mediaSrc
  }
}

function titleOf(view: OverlayView): string {
  return view.filename || fileBase(view.path) || 'Preview'
}

/**
 * Chrome-less overlay for conversation-opened visuals:
 * App / html, images, Vega-Lite, Mermaid, Graphviz.
 * Edge-to-edge content + overlay close. Zoom is gesture-only.
 * Warm shells mount with an empty path and receive content via navigate.
 */
export default function AppClipWindow({ path }: { path: string }): React.JSX.Element {
  const bootstrap = useSessionStore((s) => s.bootstrap)
  const [view, setView] = useState<OverlayView>(() => viewFromPayload({ path }))
  const [mode, setMode] = useState<OverlayMode>(() => {
    if (!path && !view.mediaSrc && !view.text) return 'loading'
    if (view.kind === 'image' || looksLikeImagePath(path)) return 'image'
    if (view.text && (view.kind === 'diagram' || view.diagramKind)) return 'diagram'
    if (view.text) return 'app'
    return 'loading'
  })
  const [error, setError] = useState<string | null>(null)

  useAppearance()

  useEffect(() => {
    document.title = titleOf(view)
  }, [view])

  useEffect(() => {
    const offSettings = installSettingsBridge()
    const offCtx = installDefaultContextMenu()
    const offMenu = window.vav.onMenuCommand((command) => {
      if (command === 'close-context') window.close()
    })
    const offNav = window.vav.window.onPreviewNavigate?.((payload) => {
      setView(viewFromPayload(payload))
      setError(null)
    })
    const idle = window.setTimeout(() => {
      void bootstrap(undefined, { light: true })
    }, 0)
    return () => {
      window.clearTimeout(idle)
      offSettings()
      offCtx()
      offMenu()
      offNav?.()
    }
  }, [bootstrap])

  useEffect(() => {
    if (!view.path && !view.text && !view.mediaSrc) {
      setMode('loading')
      window.vav.window.previewShellReady?.()
      return
    }
    if (view.kind === 'image' || looksLikeImagePath(view.path) || view.mediaSrc) {
      if (view.mediaSrc || view.path) {
        setMode('image')
        setError(null)
        return
      }
    }
    if (view.text != null && view.text.length > 0) {
      if (view.kind === 'diagram' || view.diagramKind) setMode('diagram')
      else setMode('app')
      setError(null)
      return
    }
    if (!view.path) {
      setMode('loading')
      return
    }
    if (looksLikeImagePath(view.path)) {
      setMode('image')
      setError(null)
      return
    }
    let cancelled = false
    void window.vav.files.inspect(view.path).then(async (info) => {
      if (cancelled) return
      const diagram = view.diagramKind ?? diagramKindFromPath(view.path)
      if (info.kind === 'image') {
        setView((prev) => ({
          ...prev,
          kind: 'image',
          mediaSrc: info.streamUrl || localFileStreamUrl(view.path)
        }))
        setMode('image')
        setError(null)
        return
      }
      let text = info.text ?? ''
      if (info.truncated) {
        const full = await window.vav.files.read(view.path)
        if (full.content) text = full.content
      }
      if (cancelled) return
      if (diagram) {
        if (!text.trim()) {
          setError(info.error || 'Failed to open diagram')
          setMode('error')
          return
        }
        setView((prev) => ({ ...prev, kind: 'diagram', diagramKind: diagram, text }))
        setMode('diagram')
        setError(null)
        return
      }
      if (text.length > 0) {
        setView((prev) => ({ ...prev, kind: 'app', text }))
        setMode('app')
        setError(null)
        return
      }
      setError(info.error || 'Failed to open')
      setMode('error')
    })
    return () => {
      cancelled = true
    }
  }, [view.path, view.text, view.mediaSrc, view.kind, view.diagramKind])

  const imageSrc =
    view.mediaSrc || (mode === 'image' && view.path ? localFileStreamUrl(view.path) : null)
  const label = titleOf(view)

  return (
    <div className="app-clip-window">
      <div className="app-clip-drag" />
      <button
        type="button"
        className="app-clip-close"
        title={tt('common.close')}
        aria-label={tt('common.close')}
        onClick={() => window.close()}
      />
      {mode === 'app' && view.text ? (
        <HtmlClipFrame source={view.text} title={label || 'App'} fill />
      ) : null}
      {mode === 'image' && imageSrc ? (
        <OverlayImage src={imageSrc} alt={label} filename={label} />
      ) : null}
      {mode === 'diagram' && view.text ? (
        <DiagramFileView
          kind={view.diagramKind ?? 'mermaid'}
          text={view.text}
          selecting={false}
          selectedIds={[]}
          onSelect={() => undefined}
          showControls={false}
        />
      ) : null}
      {mode === 'loading' || mode === 'error' ? (
        <div className="app-clip-status">{error || (view.path || view.text || view.mediaSrc ? tt('common.loading') : '')}</div>
      ) : null}
    </div>
  )
}
