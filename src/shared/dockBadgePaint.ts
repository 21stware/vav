/**
 * Paint a macOS-style numeric badge into a BGRA icon bitmap.
 *
 * `app.dock.setBadge` needs notification permission and is a no-op when
 * banners are off — the count has to live in the tile itself.
 */

const BADGE_RED = { r: 255, g: 59, b: 48 }
const BADGE_HALO = { r: 255, g: 255, b: 255 }

const DIGITS: Record<string, string[]> = {
  '0': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  '3': ['01110', '10001', '00001', '00110', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['01110', '10001', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '10001', '01110'],
  '+': ['00100', '00100', '11111', '00100', '00100', '00000', '00000']
}

export function paintDockBadge(
  bgra: Buffer,
  width: number,
  height: number,
  text: string
): void {
  const label = text.trim()
  if (!label || width < 16 || height < 16 || bgra.length < width * height * 4) return

  const bounds = opaqueBounds(bgra, width, height)
  const box = bounds ?? { x0: 0, y0: 0, x1: width, y1: height }
  const span = Math.min(box.x1 - box.x0, box.y1 - box.y0)
  const radius = Math.max(5, Math.round(span * 0.15))
  const extra = Math.max(0, label.length - 1)
  const badgeW = Math.round(radius * 2 + extra * radius * 0.7)
  const badgeH = radius * 2

  // Halo scale: macOS Dock badges have a very thin light border.
  // We use a minimal scale to avoid the "thick white border" look.
  const haloScale = 1.02
  const hhw = (badgeW * haloScale) / 2
  const hhh = (badgeH * haloScale) / 2

  // Ensure center is far enough from edges to avoid clipping the halo.
  // We move the badge further inwards (0.9 * radius) to stay within the squircle and Dock bounds.
  const cx = Math.min(width - hhw - 4, box.x1 - Math.round(radius * 0.9))
  const cy = Math.max(hhh + 4, box.y0 + Math.round(radius * 0.9))

  fillStadium(bgra, width, height, cx, cy, badgeW, badgeH, BADGE_HALO, haloScale)
  fillStadium(bgra, width, height, cx, cy, badgeW, badgeH, BADGE_RED, 1)
  drawLabel(bgra, width, height, cx, cy, badgeW, badgeH, label)
}

function opaqueBounds(
  bgra: Buffer,
  width: number,
  height: number
): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = width
  let y0 = height
  let x1 = 0
  let y1 = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((bgra[(y * width + x) * 4 + 3] ?? 0) < 18) continue
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x + 1 > x1) x1 = x + 1
      if (y + 1 > y1) y1 = y + 1
    }
  }
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null
}

function fillStadium(
  bgra: Buffer,
  width: number,
  height: number,
  cx: number,
  cy: number,
  badgeW: number,
  badgeH: number,
  color: { r: number; g: number; b: number },
  scale: number
): void {
  const hw = (badgeW * scale) / 2
  const hh = (badgeH * scale) / 2
  const r = hh
  const x0 = Math.max(0, Math.floor(cx - hw - 1))
  const x1 = Math.min(width, Math.ceil(cx + hw + 1))
  const y0 = Math.max(0, Math.floor(cy - hh - 1))
  const y1 = Math.min(height, Math.ceil(cy + hh + 1))
  const inner = hw - r

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      const adx = Math.abs(dx) - inner
      const dist = adx <= 0 ? Math.abs(dy) : Math.hypot(adx, dy)
      const cover = edgeCover(dist, r)
      if (cover <= 0) continue
      blend(bgra, width, x, y, color, cover)
    }
  }
}

function edgeCover(dist: number, radius: number): number {
  const aa = 0.7
  if (dist <= radius - aa) return 1
  if (dist >= radius + aa) return 0
  return (radius + aa - dist) / (2 * aa)
}

function drawLabel(
  bgra: Buffer,
  width: number,
  _height: number,
  cx: number,
  cy: number,
  badgeW: number,
  badgeH: number,
  text: string
): void {
  const letters = [...text]
  const rows = 7
  const cols = 5
  const gap = 1
  const units = letters.length * cols + Math.max(0, letters.length - 1) * gap
  const scale = Math.max(1, Math.floor(Math.min((badgeW * 0.62) / units, (badgeH * 0.52) / rows)))
  const textW = units * scale
  const textH = rows * scale
  let px = Math.round(cx - textW / 2)
  const py = Math.round(cy - textH / 2)
  const ink = { r: 255, g: 255, b: 255 }

  for (const letter of letters) {
    const glyph = DIGITS[letter]
    if (!glyph) continue
    for (let gy = 0; gy < rows; gy++) {
      const row = glyph[gy] ?? ''
      for (let gx = 0; gx < cols; gx++) {
        if (row[gx] !== '1') continue
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            blend(bgra, width, px + gx * scale + sx, py + gy * scale + sy, ink, 1)
          }
        }
      }
    }
    px += (cols + gap) * scale
  }
}

function blend(
  bgra: Buffer,
  width: number,
  x: number,
  y: number,
  color: { r: number; g: number; b: number },
  alpha: number
): void {
  if (x < 0 || y < 0 || alpha <= 0) return
  const i = (y * width + x) * 4
  if (i + 3 >= bgra.length) return
  const a = Math.max(0, Math.min(1, alpha))
  const inv = 1 - a
  bgra[i] = Math.round((bgra[i] ?? 0) * inv + color.b * a)
  bgra[i + 1] = Math.round((bgra[i + 1] ?? 0) * inv + color.g * a)
  bgra[i + 2] = Math.round((bgra[i + 2] ?? 0) * inv + color.r * a)
  bgra[i + 3] = Math.max(bgra[i + 3] ?? 0, Math.round(255 * a))
}
