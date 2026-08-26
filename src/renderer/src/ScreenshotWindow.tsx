import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  Check,
  Circle,
  Copy,
  Download,
  Minus,
  Move,
  Square,
  Type,
  Undo2,
  Redo2,
  X
} from 'lucide-react'
import { t, type AppLocale } from '@shared/i18n'
import { localFileStreamUrl } from '@shared/localFileUrl'
import type { ScreenshotInitPayload } from '@shared/ipc'
import {
  CROP_HANDLES,
  SCREENSHOT_COLORS,
  SCREENSHOT_WIDTHS,
  clampCrop,
  cropCursor,
  cropIsUsable,
  hitCrop,
  hitMark,
  hitTopMark,
  markCursor,
  moveCrop,
  moveMark,
  normalizeRect,
  resizeCrop,
  resizeMark,
  type CropHandle,
  type CropRect,
  type MarkResizeHandle,
  type ScreenshotMark,
  type ScreenshotTool
} from '@shared/screenshotDraw'
import { paintMark, paintMarkSelection, paintMarks } from './lib/screenshotPaint'
import { exportAnnotatedPng } from './lib/screenshotExport'

const TEXT_SIZE = 16

type Gesture =
  | { kind: 'create'; x: number; y: number }
  | { kind: 'move'; origin: CropRect; startX: number; startY: number }
  | { kind: 'resize'; handle: CropHandle; origin: CropRect }
  | { kind: 'mark-move'; id: string; origin: ScreenshotMark; startX: number; startY: number }
  | { kind: 'mark-resize'; id: string; handle: MarkResizeHandle; origin: ScreenshotMark }

function nextId(): string {
  return `m-${Math.random().toString(36).slice(2, 9)}`
}

async function copyPngViaClipboardItem(base64: string): Promise<boolean> {
  try {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const blob = new Blob([bytes], { type: 'image/png' })
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return false
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return true
  } catch {
    return false
  }
}

export default function ScreenshotWindow(): React.JSX.Element {
  const [init, setInit] = useState<ScreenshotInitPayload | null>(null)
  const [crop, setCrop] = useState<CropRect | null>(null)
  const [gesture, setGesture] = useState<Gesture | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tool, setTool] = useState<ScreenshotTool>('move')
  const [color, setColor] = useState<string>(SCREENSHOT_COLORS[0])
  const [width, setWidth] = useState<number>(SCREENSHOT_WIDTHS[1])
  const [marks, setMarks] = useState<ScreenshotMark[]>([])
  const [redo, setRedo] = useState<ScreenshotMark[]>([])
  const [textDraft, setTextDraft] = useState<{ x: number; y: number; value: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cropElRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const composingRef = useRef(false)
  const cropRef = useRef<CropRect | null>(null)
  const gestureRef = useRef<Gesture | null>(null)
  const draftRef = useRef<ScreenshotMark | null>(null)
  const liveMarkRef = useRef<ScreenshotMark | null>(null)
  const selectedIdRef = useRef<string | null>(null)
  const paintRaf = useRef(0)
  const paintedNonce = useRef<number | null>(null)
  const marksRef = useRef(marks)
  marksRef.current = marks
  selectedIdRef.current = selectedId
  const locale: AppLocale = init?.locale ?? 'en'
  const tt = (key: Parameters<typeof t>[1]) => t(locale, key)

  useEffect(() => {
    const off = window.vav.screenshot.onInit((payload) => {
      setInit(payload)
      setCrop(null)
      setGesture(null)
      cropRef.current = null
      gestureRef.current = null
      draftRef.current = null
      setTool('move')
      setColor(SCREENSHOT_COLORS[0])
      setWidth(SCREENSHOT_WIDTHS[1])
      setMarks([])
      setRedo([])
      setSelectedId(null)
      selectedIdRef.current = null
      liveMarkRef.current = null
      setTextDraft(null)
      setBusy(false)
      setCopied(false)
      setImageUrl(null)
      paintedNonce.current = null
    })
    window.vav.screenshot.ready()
    return off
  }, [])

  useEffect(() => {
    if (!init) return
    document.documentElement.lang = init.locale === 'zh-CN' ? 'zh-CN' : 'en'
  }, [init])

  useEffect(() => {
    if (!init) return
    let cancelled = false
    let objectUrl = ''
    void (async () => {
      try {
        const res = await fetch(`${localFileStreamUrl(init.imagePath)}&t=${init.nonce}`)
        if (!res.ok) return
        const blob = await res.blob()
        objectUrl = URL.createObjectURL(blob)
        if (cancelled) {
          URL.revokeObjectURL(objectUrl)
          return
        }
        setImageUrl(objectUrl)
      } catch (err) {
        console.error('[screenshot] image fetch failed', err)
      }
    })()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [init])

  useEffect(() => {
    if (!textDraft) return
    const id = window.requestAnimationFrame(() => {
      const el = textRef.current
      if (!el) return
      el.focus()
      const end = el.value.length
      try {
        el.setSelectionRange(end, end)
      } catch {
        // ignore
      }
    })
    return () => window.cancelAnimationFrame(id)
  }, [textDraft])

  const maxW = init?.displayWidth ?? window.innerWidth
  const maxH = init?.displayHeight ?? window.innerHeight

  const applyCropBox = useCallback((next: CropRect | null) => {
    cropRef.current = next
    const el = cropElRef.current
    if (!el) return
    if (!next) {
      el.style.display = 'none'
      return
    }
    el.style.display = 'block'
    el.style.left = `${next.x}px`
    el.style.top = `${next.y}px`
    el.style.width = `${next.w}px`
    el.style.height = `${next.h}px`
  }, [])

  const paintMarksOnly = useCallback(() => {
    const canvas = canvasRef.current
    const box = cropRef.current
    if (!canvas || !box) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const nextW = Math.max(1, Math.round(box.w * dpr))
    const nextH = Math.max(1, Math.round(box.h * dpr))
    if (canvas.width !== nextW || canvas.height !== nextH) {
      canvas.width = nextW
      canvas.height = nextH
      canvas.style.width = `${box.w}px`
      canvas.style.height = `${box.h}px`
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, box.w, box.h)
    const liveMark = liveMarkRef.current
    const painted = marksRef.current.map((mark) =>
      liveMark && mark.id === liveMark.id ? liveMark : mark
    )
    paintMarks(ctx, painted)
    const live = draftRef.current
    if (live) paintMark(ctx, live)
    const selected = painted.find((mark) => mark.id === selectedIdRef.current)
    if (selected) paintMarkSelection(ctx, selected)
  }, [])

  const schedulePaint = useCallback(() => {
    if (paintRaf.current) return
    paintRaf.current = window.requestAnimationFrame(() => {
      paintRaf.current = 0
      paintMarksOnly()
    })
  }, [paintMarksOnly])

  useEffect(() => {
    schedulePaint()
  }, [marks, selectedId, schedulePaint])

  const selectMark = useCallback(
    (id: string | null) => {
      selectedIdRef.current = id
      setSelectedId(id)
      schedulePaint()
    },
    [schedulePaint]
  )

  useEffect(() => {
    window.vav.screenshot.setKey(Boolean(textDraft))
    return () => {
      window.vav.screenshot.setKey(false)
    }
  }, [textDraft])

  const announcePainted = useCallback(async (image: HTMLImageElement, nonce: number) => {
    try {
      await image.decode()
    } catch {
      return
    }
    if (paintedNonce.current === nonce) return
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve())
      })
    })
    if (paintedNonce.current === nonce) return
    paintedNonce.current = nonce
    window.vav.screenshot.painted()
  }, [])

  const commitText = useCallback((): void => {
    setTextDraft((cur) => {
      if (!cur) return null
      const value = cur.value.trim()
      if (value) {
        const id = nextId()
        setMarks((marksNow) => [
          ...marksNow,
          {
            id,
            kind: 'text',
            x: cur.x,
            y: cur.y,
            text: value,
            color,
            fontSize: TEXT_SIZE
          }
        ])
        setRedo([])
        selectedIdRef.current = id
        setSelectedId(id)
      }
      return null
    })
  }, [color])

  const encodedPng = useCallback((): string | null => {
    const image = imageRef.current
    const box = cropRef.current
    if (!image || !box || !init) return null
    let nextMarks = marksRef.current
    const pendingText = textDraft
    if (pendingText) {
      const value = pendingText.value.trim()
      if (value) {
        nextMarks = [
          ...nextMarks,
          {
            id: nextId(),
            kind: 'text',
            x: pendingText.x,
            y: pendingText.y,
            text: value,
            color,
            fontSize: TEXT_SIZE
          }
        ]
        marksRef.current = nextMarks
        setMarks(nextMarks)
      }
      setTextDraft(null)
    }
    try {
      return exportAnnotatedPng(image, box, nextMarks, maxW, maxH)
    } catch (err) {
      console.error('[screenshot] encode failed', err)
      return null
    }
  }, [color, init, maxH, maxW, textDraft])

  const cancel = useCallback(() => {
    if (busy) return
    window.vav.screenshot.finish({ ok: false })
    setBusy(true)
  }, [busy])

  const confirm = useCallback(() => {
    const box = cropRef.current ?? crop
    if (!box || !cropIsUsable(box) || busy) return
    const base64 = encodedPng()
    if (!base64) {
      window.vav.screenshot.finish({ ok: false })
      return
    }
    window.vav.screenshot.dismiss()
    setBusy(true)
    void window.vav.files
      .writeClip({ filename: 'screenshot.png', base64 })
      .then((written) => {
        if (!written.ok) {
          window.vav.screenshot.finish({ ok: false })
          return
        }
        window.vav.screenshot.finish({ ok: true, path: written.path })
      })
      .catch(() => {
        window.vav.screenshot.finish({ ok: false })
      })
  }, [busy, crop, encodedPng])

  const copyImage = useCallback(async () => {
    if (!crop || busy) return
    const base64 = encodedPng()
    if (!base64) return
    try {
      const written = await window.vav.files.writeClip({ filename: 'screenshot.png', base64 })
      if (written.ok) {
        const fromFile = await window.vav.files.copyImage(written.path)
        if (fromFile.ok) {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1400)
          return
        }
      }
      const fromIpc = await window.vav.conversations.copyImageToClipboard(base64)
      if (fromIpc.ok) {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1400)
        return
      }
      if (await copyPngViaClipboardItem(base64)) {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1400)
      }
    } catch (err) {
      console.error('[screenshot] copy failed', err)
    }
  }, [busy, crop, encodedPng])

  const saveImage = useCallback(async () => {
    if (!crop || busy) return
    const base64 = encodedPng()
    if (!base64) return
    const dest = await window.vav.files.saveAs('screenshot.png', '')
    if (!dest.ok) return
    await window.vav.files.writeBinary(dest.path, base64)
  }, [busy, crop, encodedPng])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) {
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        if (textDraft) {
          setTextDraft(null)
          return
        }
        if (selectedIdRef.current) {
          selectMark(null)
          return
        }
        cancel()
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) {
          setRedo((queue) => {
            const next = queue[queue.length - 1]
            if (!next) return queue
            setMarks((cur) => [...cur, next])
            return queue.slice(0, -1)
          })
        } else {
          setMarks((cur) => {
            const last = cur[cur.length - 1]
            if (!last) return cur
            setRedo((queue) => [...queue, last])
            return cur.slice(0, -1)
          })
        }
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c' && crop && !textDraft) {
        event.preventDefault()
        void copyImage()
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && crop && !textDraft) {
        event.preventDefault()
        void confirm()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cancel, confirm, copyImage, crop, selectMark, textDraft])

  const pointInCrop = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const box = cropRef.current
    if (!box) return null
    const x = clientX - box.x
    const y = clientY - box.y
    if (x < 0 || y < 0 || x > box.w || y > box.h) return null
    return { x, y }
  }

  const setRootCursor = (value: string): void => {
    const root = rootRef.current
    if (root) root.style.cursor = value
  }

  const beginCropCreate = (
    event: React.PointerEvent<HTMLDivElement>,
    clearMarks: boolean
  ): void => {
    commitText()
    selectMark(null)
    liveMarkRef.current = null
    if (clearMarks) {
      setMarks([])
      setRedo([])
      draftRef.current = null
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    const next = { x: event.clientX, y: event.clientY, w: 0, h: 0 }
    const start = { kind: 'create' as const, x: event.clientX, y: event.clientY }
    gestureRef.current = start
    setGesture(start)
    applyCropBox(next)
    setCrop(next)
    setRootCursor('crosshair')
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || busy) return
    if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) {
      return
    }
    const box = cropRef.current
    if (event.detail >= 2 && box && cropIsUsable(box)) {
      event.preventDefault()
      commitText()
      confirm()
      return
    }
    if (!box) {
      beginCropCreate(event, false)
      return
    }
    const hit = hitCrop(box, event.clientX, event.clientY, {
      interior: tool === 'move' ? 'move' : 'inside'
    })
    if (hit && hit !== 'inside' && hit !== 'move') {
      commitText()
      selectMark(null)
      event.currentTarget.setPointerCapture(event.pointerId)
      const start = { kind: 'resize' as const, handle: hit, origin: box }
      gestureRef.current = start
      setGesture(start)
      setRootCursor(cropCursor(hit))
      return
    }
    const local = pointInCrop(event.clientX, event.clientY)
    if (local) {
      const selected = selectedIdRef.current
        ? marksRef.current.find((mark) => mark.id === selectedIdRef.current)
        : null
      const selectedHit = selected ? hitMark(selected, local.x, local.y) : null
      if (selected && selectedHit && selectedHit !== 'move') {
        commitText()
        event.currentTarget.setPointerCapture(event.pointerId)
        const start = {
          kind: 'mark-resize' as const,
          id: selected.id,
          handle: selectedHit,
          origin: selected
        }
        liveMarkRef.current = selected
        gestureRef.current = start
        setGesture(start)
        setRootCursor(markCursor(selectedHit))
        return
      }
      const top = hitTopMark(marksRef.current, local.x, local.y)
      if (top) {
        commitText()
        selectMark(top.mark.id)
        event.currentTarget.setPointerCapture(event.pointerId)
        const start = {
          kind: 'mark-move' as const,
          id: top.mark.id,
          origin: top.mark,
          startX: local.x,
          startY: local.y
        }
        liveMarkRef.current = top.mark
        gestureRef.current = start
        setGesture(start)
        setRootCursor('move')
        return
      }
    }
    if (hit === 'move') {
      commitText()
      selectMark(null)
      event.currentTarget.setPointerCapture(event.pointerId)
      const start = {
        kind: 'move' as const,
        origin: box,
        startX: event.clientX,
        startY: event.clientY
      }
      gestureRef.current = start
      setGesture(start)
      setRootCursor('move')
      return
    }
    if (!local) {
      beginCropCreate(event, true)
      return
    }
    if (tool === 'move') {
      commitText()
      selectMark(null)
      event.currentTarget.setPointerCapture(event.pointerId)
      const start = {
        kind: 'move' as const,
        origin: box,
        startX: event.clientX,
        startY: event.clientY
      }
      gestureRef.current = start
      setGesture(start)
      setRootCursor('move')
      return
    }
    if (tool === 'text') {
      commitText()
      selectMark(null)
      setTextDraft({ x: local.x, y: local.y, value: '' })
      return
    }
    commitText()
    selectMark(null)
    event.currentTarget.setPointerCapture(event.pointerId)
    const nextDraft: ScreenshotMark = {
      id: nextId(),
      kind: tool,
      x1: local.x,
      y1: local.y,
      x2: local.x,
      y2: local.y,
      color,
      width
    }
    draftRef.current = nextDraft
    schedulePaint()
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const liveGesture = gestureRef.current
    const box = cropRef.current
    if (!liveGesture && box) {
      const hit = hitCrop(box, event.clientX, event.clientY, {
        interior: tool === 'move' ? 'move' : 'inside'
      })
      const local = pointInCrop(event.clientX, event.clientY)
      const markHit = local ? hitTopMark(marksRef.current, local.x, local.y)?.hit : null
      const selected = selectedIdRef.current
        ? marksRef.current.find((mark) => mark.id === selectedIdRef.current)
        : null
      const selectedHit = selected && local ? hitMark(selected, local.x, local.y) : null
      setRootCursor(
        selectedHit && selectedHit !== 'move'
          ? markCursor(selectedHit)
          : markHit
            ? 'move'
            : tool === 'text' && hit === 'inside'
              ? 'text'
              : cropCursor(hit) || 'crosshair'
      )
      rootRef.current?.classList.toggle('is-text', tool === 'text' && hit === 'inside' && !markHit)
    }
    if (liveGesture?.kind === 'create') {
      applyCropBox(
        clampCrop(
          normalizeRect(liveGesture.x, liveGesture.y, event.clientX, event.clientY),
          maxW,
          maxH
        )
      )
      return
    }
    if (liveGesture?.kind === 'move') {
      applyCropBox(
        moveCrop(
          liveGesture.origin,
          event.clientX - liveGesture.startX,
          event.clientY - liveGesture.startY,
          maxW,
          maxH
        )
      )
      return
    }
    if (liveGesture?.kind === 'resize') {
      applyCropBox(
        resizeCrop(
          liveGesture.origin,
          liveGesture.handle,
          event.clientX,
          event.clientY,
          maxW,
          maxH
        )
      )
      schedulePaint()
      return
    }
    if ((liveGesture?.kind === 'mark-move' || liveGesture?.kind === 'mark-resize') && box) {
      const local = pointInCrop(event.clientX, event.clientY) ?? {
        x: Math.max(0, Math.min(event.clientX - box.x, box.w)),
        y: Math.max(0, Math.min(event.clientY - box.y, box.h))
      }
      liveMarkRef.current =
        liveGesture.kind === 'mark-move'
          ? moveMark(
              liveGesture.origin,
              local.x - liveGesture.startX,
              local.y - liveGesture.startY,
              box.w,
              box.h
            )
          : resizeMark(liveGesture.origin, liveGesture.handle, local.x, local.y, box.w, box.h)
      schedulePaint()
      return
    }
    const liveDraft = draftRef.current
    if (liveDraft && liveDraft.kind !== 'text') {
      const local = pointInCrop(event.clientX, event.clientY)
      if (!local) return
      draftRef.current = { ...liveDraft, x2: local.x, y2: local.y }
      schedulePaint()
    }
  }

  const onPointerUp = (): void => {
    const liveGesture = gestureRef.current
    const box = cropRef.current
    if (liveGesture?.kind === 'create' && box) {
      const next = clampCrop(box, maxW, maxH)
      gestureRef.current = null
      setGesture(null)
      if (!cropIsUsable(next)) {
        applyCropBox(null)
        setCrop(null)
      } else {
        applyCropBox(next)
        setCrop(next)
        schedulePaint()
      }
      return
    }
    if (liveGesture?.kind === 'mark-move' || liveGesture?.kind === 'mark-resize') {
      const next = liveMarkRef.current
      gestureRef.current = null
      setGesture(null)
      liveMarkRef.current = null
      if (next) {
        setMarks((cur) => cur.map((mark) => (mark.id === next.id ? next : mark)))
        selectMark(next.id)
      }
      return
    }
    if (liveGesture) {
      gestureRef.current = null
      setGesture(null)
      if (box) setCrop(box)
      return
    }
    const liveDraft = draftRef.current
    if (liveDraft && liveDraft.kind !== 'text') {
      const region = normalizeRect(liveDraft.x1, liveDraft.y1, liveDraft.x2, liveDraft.y2)
      if (liveDraft.kind === 'rect' || liveDraft.kind === 'ellipse' ? cropIsUsable(region, 4) : true) {
        setMarks((cur) => [...cur, liveDraft])
        setRedo([])
        selectMark(liveDraft.id)
      }
      draftRef.current = null
      schedulePaint()
    }
  }

  if (!init) return <div className="screenshot-root" />

  const toolbar = crop && !gesture
  const toolbarStyle = toolbar
    ? {
        left: Math.min(maxW - 420, Math.max(8, crop.x)),
        top: crop.y + crop.h + 10 + 44 > maxH ? Math.max(8, crop.y - 48) : crop.y + crop.h + 10
      }
    : undefined

  return (
    <div
      ref={rootRef}
      className={`screenshot-root${busy ? ' is-done' : ''}`}
      data-testid="screenshot-overlay"
      data-selected-mark={selectedId ?? undefined}
      onContextMenu={(event) => {
        event.preventDefault()
        cancel()
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {imageUrl ? (
        <img
          ref={imageRef}
          className="screenshot-bg"
          src={imageUrl}
          alt=""
          draggable={false}
          onLoad={(event) => {
            if (!init) return
            void announcePainted(event.currentTarget, init.nonce)
          }}
        />
      ) : null}
      {!crop ? <p className="screenshot-hint">{tt('screenshot.hint')}</p> : null}
      {crop ? (
        <div
          ref={cropElRef}
          className="screenshot-crop"
          data-testid="screenshot-crop"
          style={{ left: crop.x, top: crop.y, width: crop.w, height: crop.h }}
        >
          <canvas ref={canvasRef} className="screenshot-canvas" />
          {CROP_HANDLES.map((handle) => (
            <span
              key={handle}
              className={`screenshot-handle screenshot-handle-${handle}`}
              data-handle={handle}
            />
          ))}
          {textDraft ? (
            <textarea
              ref={textRef}
              className="screenshot-text"
              lang={locale === 'zh-CN' ? 'zh-CN' : 'en'}
              style={{ left: textDraft.x, top: textDraft.y, color }}
              value={textDraft.value}
              rows={1}
              autoFocus
              spellCheck={false}
              onPointerDown={(event) => event.stopPropagation()}
              onPointerUp={(event) => event.stopPropagation()}
              onChange={(event) =>
                setTextDraft((cur) => (cur ? { ...cur, value: event.target.value } : cur))
              }
              onCompositionStart={() => {
                composingRef.current = true
              }}
              onCompositionEnd={() => {
                composingRef.current = false
              }}
              onKeyDown={(event) => {
                event.stopPropagation()
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setTextDraft(null)
                  return
                }
                if (event.key === 'Enter' && !event.shiftKey && !composingRef.current) {
                  event.preventDefault()
                  commitText()
                }
              }}
            />
          ) : null}
        </div>
      ) : null}
      {toolbar ? (
        <div
          className="screenshot-toolbar"
          style={toolbarStyle}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <ToolButton
            label={tt('screenshot.move')}
            active={tool === 'move'}
            onClick={() => setTool('move')}
          >
            <Move size={14} />
          </ToolButton>
          <ToolButton
            label={tt('screenshot.rect')}
            active={tool === 'rect'}
            testId="screenshot-rect"
            onClick={() => setTool('rect')}
          >
            <Square size={14} />
          </ToolButton>
          <ToolButton
            label={tt('screenshot.ellipse')}
            active={tool === 'ellipse'}
            onClick={() => setTool('ellipse')}
          >
            <Circle size={14} />
          </ToolButton>
          <ToolButton
            label={tt('screenshot.arrow')}
            active={tool === 'arrow'}
            onClick={() => setTool('arrow')}
          >
            <ArrowUpRight size={14} />
          </ToolButton>
          <ToolButton
            label={tt('screenshot.line')}
            active={tool === 'line'}
            onClick={() => setTool('line')}
          >
            <Minus size={14} />
          </ToolButton>
          <ToolButton
            label={tt('screenshot.text')}
            active={tool === 'text'}
            onClick={() => setTool('text')}
          >
            <Type size={14} />
          </ToolButton>
          <span className="screenshot-sep" />
          {SCREENSHOT_COLORS.map((swatch) => (
            <button
              key={swatch}
              type="button"
              className={`screenshot-swatch${color === swatch ? ' is-active' : ''}`}
              style={{ background: swatch }}
              aria-label={swatch}
              onClick={() => {
                setColor(swatch)
                const id = selectedIdRef.current
                if (!id) return
                setMarks((cur) =>
                  cur.map((mark) => (mark.id === id ? { ...mark, color: swatch } : mark))
                )
              }}
            />
          ))}
          <span className="screenshot-sep" />
          {SCREENSHOT_WIDTHS.map((value) => (
            <button
              key={value}
              type="button"
              className={`screenshot-width${width === value ? ' is-active' : ''}`}
              aria-label={String(value)}
              onClick={() => {
                setWidth(value)
                const id = selectedIdRef.current
                if (!id) return
                setMarks((cur) =>
                  cur.map((mark) =>
                    mark.id === id && mark.kind !== 'text' ? { ...mark, width: value } : mark
                  )
                )
              }}
            >
              <span style={{ width: value + 4, height: value }} />
            </button>
          ))}
          <span className="screenshot-sep" />
          <ToolButton
            label={tt('screenshot.undo')}
            disabled={marks.length === 0}
            onClick={() => {
              setMarks((cur) => {
                const last = cur[cur.length - 1]
                if (!last) return cur
                setRedo((queue) => [...queue, last])
                return cur.slice(0, -1)
              })
            }}
          >
            <Undo2 size={14} />
          </ToolButton>
          <ToolButton
            label={tt('screenshot.redo')}
            disabled={redo.length === 0}
            onClick={() => {
              setRedo((queue) => {
                const next = queue[queue.length - 1]
                if (!next) return queue
                setMarks((cur) => [...cur, next])
                return queue.slice(0, -1)
              })
            }}
          >
            <Redo2 size={14} />
          </ToolButton>
          <span className="screenshot-sep" />
          <ToolButton
            label={copied ? tt('screenshot.copied') : tt('screenshot.copy')}
            active={copied}
            testId="screenshot-copy"
            copied={copied}
            onClick={() => void copyImage()}
          >
            <Copy size={14} />
          </ToolButton>
          <ToolButton label={tt('screenshot.save')} onClick={() => void saveImage()}>
            <Download size={14} />
          </ToolButton>
          <ToolButton label={tt('screenshot.cancel')} onClick={cancel}>
            <X size={14} />
          </ToolButton>
          <ToolButton
            label={tt('screenshot.ok')}
            kind="ok"
            disabled={busy}
            onClick={() => void confirm()}
          >
            <Check size={14} />
          </ToolButton>
        </div>
      ) : null}
    </div>
  )
}

function ToolButton({
  label,
  active,
  disabled,
  kind,
  testId,
  copied,
  onClick,
  children
}: {
  label: string
  active?: boolean
  disabled?: boolean
  kind?: 'ok'
  testId?: string
  copied?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`screenshot-tool${active ? ' is-active' : ''}${kind === 'ok' ? ' is-ok' : ''}`}
      title={label}
      aria-label={label}
      data-testid={testId}
      data-copied={copied ? 'true' : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
