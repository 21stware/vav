import { clampUiZoom, uiZoomAppliesToUrl } from '../../shared/uiZoom.ts'

export type ZoomableContents = {
  isDestroyed: () => boolean
  getURL: () => string
  getZoomFactor?: () => number
  setZoomFactor: (factor: number) => void
  setVisualZoomLevelLimits?: (min: number, max: number) => Promise<unknown>
}

/** Apply persisted UI zoom, or 1× for overlay / measured-popup URLs. */
export function applyUiZoomFactor(contents: ZoomableContents, uiZoom: number): void {
  if (contents.isDestroyed()) return
  const factor = uiZoomAppliesToUrl(contents.getURL()) ? clampUiZoom(uiZoom) : 1
  try {
    const current = contents.getZoomFactor?.()
    if (current == null || Math.abs(current - factor) >= 0.001) {
      contents.setZoomFactor(factor)
    }
  } catch {
    // Created but not yet attached to a live renderer.
  }
  // Pinch / Ctrl+wheel must not drift away from the Appearance value.
  void contents.setVisualZoomLevelLimits?.(1, 1)
}
