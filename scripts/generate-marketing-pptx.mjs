#!/usr/bin/env node
/** Writes docs/marketing-samples/q3-ops-review.pptx — three pickable slides. */
import PptxGenJS from 'pptxgenjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dark = process.argv.includes('--dark') || process.env.VAV_MARKETING_THEME === 'dark'
const out = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'docs/marketing-samples/q3-ops-review.pptx'
)
const pres = new PptxGenJS()
pres.defineLayout({ name: 'WIDE', width: 13.333, height: 7.5 })
pres.layout = 'WIDE'
pres.author = 'VAV'
pres.title = 'Q3 ops review'
pres.subject = 'Marketing sample deck'

const INK = dark ? 'EFEFF1' : '141416'
const MUTED = dark ? 'A2A2A9' : '5C5C66'
const FAINT = dark ? '73737B' : '8A8A94'
const PAPER = dark ? '1B1B1D' : 'F7F7F4'
const CARD = dark ? '242427' : 'FFFFFF'
const LINE = dark ? '3A3A40' : 'E4E4E8'
const ACCENT = dark ? 'B7AAF3' : '6B5BC0'
const DANGER = dark ? 'E8817C' : 'A33B3B'
const WARN = dark ? 'D8AC62' : '8F6A15'
const ON_ACCENT = dark ? '141416' : 'FFFFFF'

const s1 = pres.addSlide()
s1.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 7.5, fill: { color: PAPER } })
s1.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: 0.14, h: 7.5, fill: { color: ACCENT } })
s1.addText('Q3  ·  Ops', {
  x: 0.9,
  y: 1.85,
  w: 11,
  h: 0.4,
  fontFace: 'Arial',
  fontSize: 14,
  color: ACCENT,
  margin: 0
})
s1.addText('Q3 ops review', {
  x: 0.9,
  y: 2.3,
  w: 11.2,
  h: 1.05,
  fontFace: 'Arial',
  fontSize: 44,
  bold: true,
  color: INK,
  margin: 0
})
s1.addText('APAC led shipped revenue. Restock focus for AMER and EMEA.', {
  x: 0.9,
  y: 3.45,
  w: 10,
  h: 0.5,
  fontFace: 'Arial',
  fontSize: 18,
  color: MUTED,
  margin: 0
})
s1.addText('Internal  ·  12 min  ·  Three slides', {
  x: 0.9,
  y: 6.7,
  w: 8,
  h: 0.3,
  fontFace: 'Arial',
  fontSize: 12,
  color: FAINT,
  margin: 0
})

const s2 = pres.addSlide()
s2.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 7.5, fill: { color: PAPER } })
s2.addText('Where we’re blocked', {
  x: 0.7,
  y: 0.38,
  w: 10,
  h: 0.7,
  fontFace: 'Arial',
  fontSize: 32,
  bold: true,
  color: INK,
  margin: 0
})
s2.addText('Pick a card — the agent edits the same .pptx on disk.', {
  x: 0.7,
  y: 1.08,
  w: 11,
  h: 0.35,
  fontFace: 'Arial',
  fontSize: 14,
  color: MUTED,
  margin: 0
})

const cards = [
  { t: 'AMER restock', d: 'WIDGET-A × 200 still pending warehouse confirm.', tag: 'Blocker', color: DANGER },
  { t: 'EMEA WIDGET-C', d: '22 units — expedite this week or drop from the Q3 target.', tag: 'Decide', color: WARN },
  { t: 'Cancelled noise', d: 'AMER WIDGET-B is cancelled. Keep it out of fulfillment totals.', tag: 'Hygiene', color: ACCENT }
]
cards.forEach((card, i) => {
  const x = 0.7 + i * 4.1
  s2.addShape(pres.ShapeType.roundRect, {
    x,
    y: 1.7,
    w: 3.85,
    h: 4.5,
    fill: { color: CARD },
    rectRadius: 0.12,
    shadow: { type: 'outer', color: '141416', blur: 12, opacity: 0.08, offset: 2 }
  })
  s2.addShape(pres.ShapeType.roundRect, {
    x: x + 0.28,
    y: 2.0,
    w: 1.35,
    h: 0.32,
    fill: { color: card.color },
    rectRadius: 0.06
  })
  s2.addText(card.tag, {
    x: x + 0.28,
    y: 2.0,
    w: 1.35,
    h: 0.32,
    fontFace: 'Arial',
    fontSize: 11,
    bold: true,
    color: ON_ACCENT,
    align: 'center',
    valign: 'middle',
    margin: 0
  })
  s2.addText(card.t, {
    x: x + 0.28,
    y: 2.55,
    w: 3.3,
    h: 0.85,
    fontFace: 'Arial',
    fontSize: 22,
    bold: true,
    color: INK,
    margin: 0
  })
  s2.addText(card.d, {
    x: x + 0.28,
    y: 3.5,
    w: 3.3,
    h: 1.8,
    fontFace: 'Arial',
    fontSize: 15,
    color: MUTED,
    margin: 0
  })
})

const s3 = pres.addSlide()
s3.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 7.5, fill: { color: PAPER } })
s3.addText('Next 7 days', {
  x: 0.8,
  y: 0.45,
  w: 10,
  h: 0.65,
  fontFace: 'Arial',
  fontSize: 32,
  bold: true,
  color: INK,
  margin: 0
})
const steps = [
  'Confirm AMER WIDGET-A with warehouse — or cut the line.',
  'EMEA: expedite 22 units, else drop WIDGET-C from the target.',
  'Rebuild the region × SKU sheet without cancelled rows.',
  'One-page PDF for stand-up; deck stays the source of truth.'
]
steps.forEach((line, i) => {
  const y = 1.5 + i * 1.2
  s3.addShape(pres.ShapeType.roundRect, {
    x: 0.8,
    y,
    w: 11.7,
    h: 1.0,
    fill: { color: CARD },
    line: { color: LINE, width: 1 },
    rectRadius: 0.08
  })
  s3.addShape(pres.ShapeType.ellipse, {
    x: 1.05,
    y: y + 0.28,
    w: 0.44,
    h: 0.44,
    fill: { color: ACCENT }
  })
  s3.addText(String(i + 1), {
    x: 1.05,
    y: y + 0.28,
    w: 0.44,
    h: 0.44,
    fontFace: 'Arial',
    fontSize: 14,
    bold: true,
    color: ON_ACCENT,
    align: 'center',
    valign: 'middle',
    margin: 0
  })
  s3.addText(line, {
    x: 1.7,
    y: y + 0.22,
    w: 10.4,
    h: 0.56,
    fontFace: 'Arial',
    fontSize: 18,
    color: INK,
    valign: 'middle',
    margin: 0
  })
})

await pres.writeFile({ fileName: out })
console.log('wrote', out)
