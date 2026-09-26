import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FILE_ASSOCIATION_CATEGORIES,
  FILE_ASSOCIATION_FORMATS,
  GENERIC_FILE_ICON,
  formatById,
  formatIdForExtension,
  formatIdForPath,
  formatUtis
} from './fileAssociationFormats.ts'
import { fileTypeIconSvg } from './fileTypeIconSvg.ts'
import { PREVIEW_AUDIO_EXTS, PREVIEW_IMAGE_EXTS, PREVIEW_VIDEO_EXTS } from './previewKind.ts'
import { DATA_FILE_EXTENSIONS } from './dataFile.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

describe('file association document icons', () => {
  it('gives every format a unique id, badge and color', () => {
    const ids = FILE_ASSOCIATION_FORMATS.map((format) => format.id)
    const badges = FILE_ASSOCIATION_FORMATS.map((format) => format.badge)
    const colors = FILE_ASSOCIATION_FORMATS.map((format) => format.color.toLowerCase())
    assert.equal(new Set(ids).size, ids.length)
    assert.equal(new Set(badges).size, badges.length)
    assert.equal(new Set(colors).size, colors.length)
    for (const format of FILE_ASSOCIATION_FORMATS) {
      assert.match(format.color, /^#[0-9A-Fa-f]{6}$/)
      if (format.ink) assert.match(format.ink, /^#[0-9A-Fa-f]{6}$/)
      assert.ok(format.badge.length >= 1 && format.badge.length <= 5, format.badge)
      assert.ok(FILE_ASSOCIATION_CATEGORIES.includes(format.category), format.id)
    }
  })

  it('never claims one extension for two formats', () => {
    const seen = new Map<string, string>()
    for (const format of FILE_ASSOCIATION_FORMATS) {
      for (const ext of format.extensions) {
        assert.match(ext, /^\.[a-z0-9]+$/)
        assert.equal(seen.get(ext), undefined, `${ext} in ${seen.get(ext)} and ${format.id}`)
        seen.set(ext, format.id)
      }
    }
  })

  it('covers every media and data extension the viewer opens', () => {
    for (const ext of [...PREVIEW_IMAGE_EXTS, ...PREVIEW_AUDIO_EXTS, ...PREVIEW_VIDEO_EXTS, ...DATA_FILE_EXTENSIONS]) {
      assert.ok(formatIdForExtension(ext), `no format for ${ext}`)
    }
  })

  it('resolves supported extensions to a format id', () => {
    assert.equal(formatIdForPath('/tmp/notes.md'), 'markdown')
    assert.equal(formatIdForPath('C:\\work\\app.tsx'), 'typescript')
    assert.equal(formatIdForPath('/src/index.mjs'), 'javascript')
    assert.equal(formatIdForExtension('PY'), 'python')
    assert.equal(formatIdForPath('/tmp/README'), null)
    assert.equal(formatById('csv')?.badge, 'CSV')
    assert.deepEqual(formatUtis(formatById('c')!), ['public.c-source', 'public.c-header'])
  })

  it('draws the extension label only where it can be read', () => {
    const md = formatById('markdown')!
    assert.match(fileTypeIconSvg(md, 64), />MD<\/text>/)
    assert.match(fileTypeIconSvg(md, 32), />MD<\/text>/)
    assert.doesNotMatch(fileTypeIconSvg(md, 16), /<text/)
    assert.doesNotMatch(fileTypeIconSvg(GENERIC_FILE_ICON, 256), /<text/)
    assert.doesNotMatch(fileTypeIconSvg(md, 64), /id="/, 'inline copies must not declare ids')
    assert.match(fileTypeIconSvg(md, 64, { standalone: true }), /filter="url\(#ds\)"/)
  })

  it('ships a document icon for every format and the fallback', () => {
    const manifest = JSON.parse(
      readFileSync(join(root, 'build/file-icons/manifest.json'), 'utf8')
    ) as Array<{ id: string; badge: string; color: string; utis: string[] }>
    assert.equal(manifest.length, FILE_ASSOCIATION_FORMATS.length)
    for (const id of [...FILE_ASSOCIATION_FORMATS.map((format) => format.id), GENERIC_FILE_ICON.id]) {
      for (const ext of ['png', 'icns', 'ico']) {
        const file = join(root, 'build/file-icons', `${id}.${ext}`)
        assert.ok(readFileSync(file).length > 0, `missing ${file}`)
      }
    }
    for (const format of FILE_ASSOCIATION_FORMATS) {
      const row = manifest.find((item) => item.id === format.id)
      assert.ok(row, `manifest missing ${format.id} — run npm run brand:file-icons`)
      assert.equal(row.badge, format.badge)
      assert.equal(row.color, format.color)
      assert.deepEqual(row.utis, formatUtis(format))
    }
  })

  it('registers each format as its own electron-builder association with an icon', () => {
    type DocType = {
      CFBundleTypeName: string
      CFBundleTypeIconFile?: string
      LSItemContentTypes?: string[]
    }
    const config = JSON.parse(
      readFileSync(join(root, 'packages/vav-desktop/electron-builder.json'), 'utf8')
    ) as {
      extraResources: Array<{ from: string; to: string }>
      fileAssociations: Array<{ ext: string | string[]; name: string; icon?: string }>
      mac: {
        extendInfo: {
          CFBundleDocumentTypes: DocType[]
          UTImportedTypeDeclarations: Array<{ UTTypeIdentifier: string }>
        }
      }
    }
    const info = config.mac.extendInfo
    for (const format of FILE_ASSOCIATION_FORMATS) {
      const assoc = config.fileAssociations.find((entry) => entry.name === format.label)
      assert.ok(assoc, `fileAssociations missing ${format.label} — run npm run brand:file-icons`)
      assert.equal(assoc.icon, `file-icons/${format.id}`)
      const doc = info.CFBundleDocumentTypes.find((entry) => entry.CFBundleTypeName === format.label)
      assert.ok(doc, `CFBundleDocumentTypes missing ${format.label}`)
      assert.equal(doc.CFBundleTypeIconFile, `${format.id}.icns`)
      assert.deepEqual(doc.LSItemContentTypes, formatUtis(format))
      assert.ok(
        config.extraResources.some((entry) => entry.to === `${format.id}.icns`),
        `extraResources missing ${format.id}.icns`
      )
      if (format.importConformsTo) {
        assert.ok(
          info.UTImportedTypeDeclarations.some((decl) => decl.UTTypeIdentifier === format.uti),
          `UTImportedTypeDeclarations missing ${format.uti}`
        )
      }
    }
    const files = info.CFBundleDocumentTypes.find((entry) => entry.CFBundleTypeName === 'Files')
    assert.equal(files?.CFBundleTypeIconFile, `${GENERIC_FILE_ICON.id}.icns`)
    assert.equal(info.CFBundleDocumentTypes.at(-1)?.CFBundleTypeName, 'Files', 'catch-all must stay last')
  })
})
