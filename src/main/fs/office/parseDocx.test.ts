import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import JSZip from 'jszip'
import { writeFile } from 'node:fs/promises'
import { parseDocx } from './parseDocx.ts'

async function writeMinimalDocx(path: string, bodyXml: string): Promise<void> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  )
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  )
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${bodyXml}
  </w:body>
</w:document>`
  )
  const buf = await zip.generateAsync({ type: 'nodebuffer' })
  await writeFile(path, buf)
}

describe('parseDocx', () => {
  it('walks paragraphs and tables in document order', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-docx-'))
    const path = join(dir, 'letter.docx')
    try {
      await writeMinimalDocx(
        path,
        `<w:p><w:r><w:t>Cover title</w:t></w:r></w:p>
         <w:tbl>
           <w:tr>
             <w:tc><w:p><w:r><w:t>Name</w:t></w:r></w:p></w:tc>
             <w:tc><w:p></w:p></w:tc>
           </w:tr>
           <w:tr>
             <w:tc><w:p><w:r><w:t>Ada</w:t></w:r></w:p></w:tc>
             <w:tc><w:p><w:r><w:t>Lovelace</w:t></w:r></w:p></w:tc>
           </w:tr>
         </w:tbl>
         <w:p><w:r><w:t>After table</w:t></w:r></w:p>`
      )
      const doc = await parseDocx(path)
      assert.equal(doc.kind, 'docx')
      assert.match(doc.plainText, /Cover title/)
      assert.match(doc.plainText, /After table/)
      const table = doc.sections[0]!.blocks.find((b) => b.kind === 'table')
      assert.ok(table, 'table must appear between paragraphs')
      const cells = table!.children?.flatMap((r) => r.children ?? []) ?? []
      assert.ok(cells.some((c) => c.text === 'Ada'))
      assert.ok(
        cells.every((c) => c.startLine > 0),
        'structured DOCX cells carry real line numbers'
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('stops after maxBlocks for progressive first paint', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-docx-'))
    const path = join(dir, 'long.docx')
    try {
      const paras = Array.from(
        { length: 20 },
        (_, i) => `<w:p><w:r><w:t>P${i}</w:t></w:r></w:p>`
      ).join('')
      await writeMinimalDocx(path, paras)
      const doc = await parseDocx(path, { maxBlocks: 4 })
      assert.ok((doc.sections[0]?.blocks.length ?? 0) <= 4)
      assert.ok(doc.warnings?.some((w) => /partial/i.test(w)))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
