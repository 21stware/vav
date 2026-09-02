import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { parsePdf } from './parsePdf.ts'

function writeMinimalPdf(path: string, text: string): void {
  const stream = `BT /F1 24 Tf 72 720 Td (${text.replace(/[()\\]/g, '')}) Tj ET`
  const objects = [
    '1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj',
    '2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj',
    '3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj',
    `4 0 obj<< /Length ${stream.length} >>stream\n${stream}\nendstream\nendobj`,
    '5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj'
  ]
  let body = '%PDF-1.1\n'
  const offsets = [0]
  for (const obj of objects) {
    offsets.push(body.length)
    body += `${obj}\n`
  }
  const xrefAt = body.length
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i <= objects.length; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  body += xref
  body += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`
  writeFileSync(path, body)
}

describe('parsePdf', () => {
  it('extracts page text into structured blocks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-pdf-'))
    const path = join(dir, 'brief.pdf')
    try {
      writeMinimalPdf(path, 'Hello PDF')
      const doc = await parsePdf(path)
      assert.equal(doc.kind, 'pdf')
      assert.equal(doc.sections[0]?.kind, 'page')
      assert.match(doc.plainText, /Hello PDF/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('honors a progressive page budget', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-pdf-'))
    const path = join(dir, 'brief.pdf')
    try {
      writeMinimalPdf(path, 'Hello PDF')
      const doc = await parsePdf(path, { maxPages: 1 })
      assert.equal(doc.sections.length, 1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
