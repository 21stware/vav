import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FILE_ASSOCIATION_FORMATS,
  formatById,
  formatIdForExtension,
  formatIdForPath
} from './fileAssociationFormats.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

describe('file association document icons', () => {
  it('gives every format a unique badge and color', () => {
    const badges = FILE_ASSOCIATION_FORMATS.map((format) => format.badge)
    const colors = FILE_ASSOCIATION_FORMATS.map((format) => format.color)
    assert.equal(new Set(badges).size, badges.length)
    assert.equal(new Set(colors).size, colors.length)
    for (const format of FILE_ASSOCIATION_FORMATS) {
      assert.match(format.color, /^#[0-9A-Fa-f]{6}$/)
      assert.ok(format.badge.length >= 2 && format.badge.length <= 4)
    }
  })

  it('resolves supported extensions to a format id', () => {
    assert.equal(formatIdForPath('/tmp/notes.md'), 'markdown')
    assert.equal(formatIdForPath('C:\\work\\app.tsx'), 'javascript')
    assert.equal(formatIdForExtension('PY'), 'python')
    assert.equal(formatIdForPath('/tmp/README'), null)
    assert.equal(formatById('csv')?.badge, 'CSV')
  })

  it('ships a document icon for every format', () => {
    const manifest = JSON.parse(
      readFileSync(join(root, 'build/file-icons/manifest.json'), 'utf8')
    ) as Array<{ id: string; badge: string; color: string }>
    for (const format of FILE_ASSOCIATION_FORMATS) {
      const png = join(root, 'build/file-icons', `${format.id}.png`)
      const icns = join(root, 'build/file-icons', `${format.id}.icns`)
      const ico = join(root, 'build/file-icons', `${format.id}.ico`)
      assert.ok(readFileSync(png).length > 0, `missing ${png}`)
      assert.ok(readFileSync(icns).length > 0, `missing ${icns}`)
      assert.ok(readFileSync(ico).length > 0, `missing ${ico}`)
      const row = manifest.find((item) => item.id === format.id)
      assert.ok(row, `manifest missing ${format.id}`)
      assert.equal(row.badge, format.badge)
      assert.equal(row.color, format.color)
    }
  })

  it('registers each format as its own electron-builder association with an icon', () => {
    const config = JSON.parse(
      readFileSync(join(root, 'packages/vav-desktop/electron-builder.json'), 'utf8')
    ) as {
      fileAssociations: Array<{ ext: string | string[]; name: string; icon?: string }>
      mac: { extendInfo: { CFBundleDocumentTypes: Array<{ CFBundleTypeName: string; CFBundleTypeIconFile?: string }> } }
    }
    for (const format of FILE_ASSOCIATION_FORMATS) {
      const assoc = config.fileAssociations.find((entry) => entry.name === format.label)
      assert.ok(assoc, `fileAssociations missing ${format.label}`)
      assert.equal(assoc.icon, `file-icons/${format.id}`)
      const doc = config.mac.extendInfo.CFBundleDocumentTypes.find(
        (entry) => entry.CFBundleTypeName === format.label
      )
      assert.ok(doc, `CFBundleDocumentTypes missing ${format.label}`)
      assert.equal(doc.CFBundleTypeIconFile, `${format.id}.icns`)
    }
  })
})
