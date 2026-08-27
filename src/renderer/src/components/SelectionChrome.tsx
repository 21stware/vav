/**
 * Selection HUD. Mounted *inside* the visual frame (sibling of the scaled
 * subject), never on the window. Scroll is compositor-native. Zoom is a CSS
 * variable written in the same turn as the subject's transform — no DOM
 * measure on either hot path.
 */

import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { SelectionAgentFab } from './SelectionAgentFab'
import {
  DOC_ZOOM_EVENT,
  DOC_ZOOM_VAR,
  chromeLayersEqual,
  chromeMutationRelevant,
  collectNaturalLayers,
  readDocZoom,
  unionNatural,
  type ChromeLayer,
  type NaturalBox
} from '../lib/selectionChrome'

export function SelectionChrome({
  hostRef,
  selectedIds,
  enabled,
  fab
}: {
  hostRef: RefObject<HTMLElement | null>
  selectedIds: string[]
  enabled: boolean
  fab?: { title: string; onClick: () => void } | null
}): React.JSX.Element | null {
  const [layers, setLayers] = useState<ChromeLayer[]>([])
  const pointerRef = useRef<EventTarget | null>(null)
  const hoverElRef = useRef<Element | null>(null)

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host || !enabled) {
      setLayers((prev) => (prev.length === 0 ? prev : []))
      pointerRef.current = null
      hoverElRef.current = null
      return
    }

    const update = (): void => {
      const next = collectNaturalLayers(host, selectedIds, pointerRef.current)
      setLayers((prev) => (chromeLayersEqual(prev, next) ? prev : next))
    }

    const onMove = (event: Event): void => {
      const t = event.target
      const el = t instanceof Element ? t : null
      pointerRef.current = el
      // Same cell: zoom/scroll must not remasure. Identity change only.
      if (el === hoverElRef.current) return
      hoverElRef.current = el
      update()
    }
    const onLeave = (event: Event): void => {
      if (event.currentTarget instanceof Document || event.target === host) {
        pointerRef.current = null
        hoverElRef.current = null
        update()
      }
    }

    const iframeUnsubs: Array<() => void> = []
    const bindIframe = (iframe: HTMLIFrameElement): void => {
      const attach = (): void => {
        const doc = iframe.contentDocument
        if (!doc) return
        doc.addEventListener('pointermove', onMove)
        doc.addEventListener('pointerleave', onLeave)
        iframeUnsubs.push(() => {
          doc.removeEventListener('pointermove', onMove)
          doc.removeEventListener('pointerleave', onLeave)
        })
        update()
      }
      if (iframe.contentDocument?.readyState === 'complete') attach()
      iframe.addEventListener('load', attach)
      iframeUnsubs.push(() => iframe.removeEventListener('load', attach))
    }
    const rebindIframes = (): void => {
      while (iframeUnsubs.length) iframeUnsubs.pop()?.()
      host.querySelectorAll('iframe').forEach(bindIframe)
    }

    update()
    rebindIframes()

    host.addEventListener('pointermove', onMove)
    host.addEventListener('pointerleave', onLeave)
    // Text-zoom reflow only. Geometric zoom writes --doc-zoom on the HUD
    // and must not remasure (that would force a layout on every pinch tick).
    host.addEventListener(DOC_ZOOM_EVENT, update)

    const selectedSet = new Set(selectedIds)
    const mo =
      typeof MutationObserver !== 'undefined'
        ? new MutationObserver((records) => {
            let needIframe = false
            let needChrome = false
            for (const rec of records) {
              if (rec.type === 'childList') {
                for (const n of rec.addedNodes) {
                  if (
                    n instanceof HTMLIFrameElement ||
                    (n instanceof Element && n.querySelector?.('iframe'))
                  ) {
                    needIframe = true
                  }
                }
              }
              if (!needChrome && chromeMutationRelevant(rec, selectedSet)) {
                needChrome = true
              }
            }
            if (needIframe) rebindIframes()
            if (needChrome) update()
          })
        : null
    mo?.observe(host, {
      subtree: true,
      childList: true,
      attributes: true,
      // Omit `style` — zoom writes transform / dataset, not chrome identity.
      attributeFilter: ['class', 'data-block-id']
    })

    return () => {
      mo?.disconnect()
      while (iframeUnsubs.length) iframeUnsubs.pop()?.()
      host.removeEventListener('pointermove', onMove)
      host.removeEventListener('pointerleave', onLeave)
      host.removeEventListener(DOC_ZOOM_EVENT, update)
    }
  }, [enabled, hostRef, selectedIds])

  if (!enabled || layers.length === 0) return null

  return (
    <>
      {layers.map((layer, index) =>
        createPortal(
          <HudLayer
            frame={layer.frame}
            boxes={layer.boxes}
            fab={index === 0 ? fab ?? null : null}
            selectedIds={selectedIds}
          />,
          layer.frame
        )
      )}
    </>
  )
}

function HudLayer({
  frame,
  boxes,
  fab,
  selectedIds
}: {
  frame: HTMLElement
  boxes: NaturalBox[]
  fab: { title: string; onClick: () => void } | null
  selectedIds: string[]
}): React.JSX.Element {
  const union = fab ? unionNatural(boxes.filter((b) => b.kind === 'selected')) : null

  return (
    <div
      className="selection-hud"
      style={{ [DOC_ZOOM_VAR]: String(readDocZoom(frame)) } as React.CSSProperties}
    >
      {boxes.map((box) => (
        <div
          key={box.id}
          className={`selection-hud-box is-${box.kind}${box.media ? ' is-media' : ''}${
            box.fill ? ' is-fill' : ''
          }`}
          style={
            box.fill
              ? undefined
              : ({
                  '--hud-x': box.x,
                  '--hud-y': box.y,
                  '--hud-w': box.w,
                  '--hud-h': box.h
                } as React.CSSProperties)
          }
        />
      ))}
      {fab && union ? (
        <SelectionAgentFab
          hostRef={{ current: frame }}
          selectedIds={selectedIds}
          title={fab.title}
          onClick={fab.onClick}
        />
      ) : null}
    </div>
  )
}
