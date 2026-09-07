import QRCode from 'qrcode'
import wordmark from '../assets/wordmark.png'

/** Center mark as a fraction of the QR — well under level-H’s ~30% recovery. */
const LOGO_RATIO = 0.12
const PAD_RATIO = 0.2
const MIN_PAD = 6

/**
 * QR with the VAV cat mark in the center. Level H + a white pad keep it
 * scannable; if the logo fails to load, the plain QR is returned.
 */
export async function qrDataUrlWithLogo(text: string, px: number): Promise<string> {
  const canvas = document.createElement('canvas')
  await QRCode.toCanvas(canvas, text, {
    margin: 2,
    width: px * 2,
    errorCorrectionLevel: 'H',
    color: { dark: '#111111', light: '#ffffff' }
  })
  try {
    const logo = await loadImage(wordmark)
    paintLogo(canvas, logo)
  } catch {
    // Plain QR is still valid.
  }
  return canvas.toDataURL('image/png')
}

function paintLogo(canvas: HTMLCanvasElement, logo: HTMLImageElement): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const size = canvas.width
  const mark = Math.round(size * LOGO_RATIO)
  const pad = Math.max(MIN_PAD, Math.round(mark * PAD_RATIO))
  const box = mark + pad * 2
  const x = (size - box) / 2
  const y = (size - box) / 2
  const radius = Math.round(box * 0.22)
  ctx.fillStyle = '#ffffff'
  roundRect(ctx, x, y, box, box, radius)
  ctx.fill()
  const natW = logo.naturalWidth || logo.width
  const natH = logo.naturalHeight || logo.height
  const scale = Math.min(mark / natW, mark / natH)
  const dw = natW * scale
  const dh = natH * scale
  ctx.drawImage(logo, x + pad + (mark - dw) / 2, y + pad + (mark - dh) / 2, dw, dh)
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('logo'))
    img.src = src
  })
}
