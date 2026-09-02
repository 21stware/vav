import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import JSZip from 'jszip'
import { parsePptx } from './parsePptx.ts'

async function writeMinimalPptx(path: string, slides: string[][]): Promise<void> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  ${slides
    .map(
      (_, i) =>
        `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
    )
    .join('\n  ')}
</Types>`
  )
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`
  )
  zip.file(
    'ppt/presentation.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldIdLst>
    ${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('\n    ')}
  </p:sldIdLst>
</p:presentation>`
  )
  for (let i = 0; i < slides.length; i++) {
    const paras = slides[i]!
      .map((text) => `<a:p><a:r><a:t>${text}</a:t></a:r></a:p>`)
      .join('')
    zip.file(
      `ppt/slides/slide${i + 1}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody>${paras}</p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`
    )
  }
  await writeFile(path, await zip.generateAsync({ type: 'nodebuffer' }))
}

describe('parsePptx', () => {
  it('walks slides in document order with title + body blocks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-pptx-'))
    const path = join(dir, 'deck.pptx')
    try {
      await writeMinimalPptx(path, [
        ['Q3 Review', 'Ship the preview canvas'],
        ['Next', 'Measure pick latency']
      ])
      const doc = await parsePptx(path)
      assert.equal(doc.kind, 'pptx')
      assert.equal(doc.sections.length, 2)
      assert.equal(doc.sections[0]?.kind, 'slide')
      assert.match(doc.plainText, /Q3 Review/)
      assert.match(doc.plainText, /Measure pick latency/)
      const title = doc.sections[0]!.blocks[0]
      assert.equal(title?.kind, 'heading')
      assert.equal(title?.label, 'Slide 1 · title')
      assert.ok((title?.startLine ?? 0) > 0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('stops after maxSlides for progressive first paint', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-pptx-'))
    const path = join(dir, 'long.pptx')
    try {
      await writeMinimalPptx(
        path,
        Array.from({ length: 8 }, (_, i) => [`Slide ${i + 1}`, `Body ${i + 1}`])
      )
      const doc = await parsePptx(path, { maxSlides: 2 })
      assert.equal(doc.sections.length, 2)
      assert.ok(doc.warnings?.some((w) => /Partial structured index/i.test(w)))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
