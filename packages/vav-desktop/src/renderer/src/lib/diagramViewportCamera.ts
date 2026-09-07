/** Pure camera math for in-chat diagram pinch-zoom / pan. */

export type ViewportView = { tx: number; ty: number; zoom: number }

export const MIN_DIAGRAM_ZOOM = 0.1
export const MAX_DIAGRAM_ZOOM = 8

export const IDENTITY_VIEW: ViewportView = { tx: 0, ty: 0, zoom: 1 }

export function clampDiagramZoom(z: number): number {
  return Math.min(MAX_DIAGRAM_ZOOM, Math.max(MIN_DIAGRAM_ZOOM, z))
}

export function isIdentityView(v: ViewportView): boolean {
  return Math.abs(v.tx) < 0.5 && Math.abs(v.ty) < 0.5 && Math.abs(v.zoom - 1) < 0.001
}

/** Keep the world point under (sx, sy) fixed when zooming. */
export function zoomViewAtClient(
  view: ViewportView,
  nextZoom: number,
  clientX: number,
  clientY: number,
  hostRect: { left: number; top: number }
): ViewportView {
  const nz = clampDiagramZoom(nextZoom)
  if (nz === view.zoom) return view
  const sxs = clientX - hostRect.left
  const sys = clientY - hostRect.top
  return {
    tx: sxs - ((sxs - view.tx) * nz) / view.zoom,
    ty: sys - ((sys - view.ty) * nz) / view.zoom,
    zoom: nz
  }
}
