import type { PointerEvent as ReactPointerEvent } from 'react'

/**
 * Splitter drag that survives HTML/PDF iframes.
 *
 * `window` mouseup never fires once the cursor enters a guest document, so
 * the handle stays "stuck" to the pointer. Capture keeps move/up on the
 * handle; `html[data-resizing]` also drops iframe pointer-events.
 */
type DragPointer = {
  button: number
  pointerId: number
  currentTarget: EventTarget | null
  preventDefault: () => void
  clientX: number
  clientY: number
}

export function startCapturedPointerDrag(
  event: ReactPointerEvent<HTMLElement> | DragPointer,
  handlers: {
    onMove: (event: { clientX: number; clientY: number }) => void
    onUp?: (event: Event) => void
    cursor?: string
    classTarget?: HTMLElement | null
    className?: string
  }
): void {
  if (event.button !== 0) return
  const target = event.currentTarget as HTMLElement | null
  if (!target || typeof target.addEventListener !== 'function') return
  event.preventDefault()

  const pointerId = event.pointerId
  const { onMove, onUp, cursor, classTarget, className } = handlers

  document.documentElement.dataset.resizing = 'true'
  if (cursor) document.body.style.cursor = cursor
  document.body.style.userSelect = 'none'
  if (classTarget && className) classTarget.classList.add(className)

  const onPointerMove = (e: Event): void => {
    const point = e as Event & { clientX?: number; clientY?: number }
    onMove({ clientX: point.clientX ?? 0, clientY: point.clientY ?? 0 })
  }

  let done = false
  const finish = (e: Event): void => {
    if (done) return
    done = true
    target.removeEventListener('pointermove', onPointerMove)
    target.removeEventListener('pointerup', finish)
    target.removeEventListener('pointercancel', finish)
    target.removeEventListener('lostpointercapture', finish)
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', finish)
    window.removeEventListener('pointercancel', finish)
    try {
      if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId)
    } catch {
      // ignore
    }
    delete document.documentElement.dataset.resizing
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    if (classTarget && className) classTarget.classList.remove(className)
    onUp?.(e)
  }

  let captured = false
  try {
    target.setPointerCapture?.(pointerId)
    captured = target.hasPointerCapture?.(pointerId) ?? false
  } catch {
    captured = false
  }

  const listenOn: EventTarget = captured ? target : window
  listenOn.addEventListener('pointermove', onPointerMove)
  listenOn.addEventListener('pointerup', finish)
  listenOn.addEventListener('pointercancel', finish)
  if (captured) target.addEventListener('lostpointercapture', finish)
}
