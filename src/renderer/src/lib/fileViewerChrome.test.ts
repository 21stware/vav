import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fileViewerShortcut, fileViewerStatusLeft } from './fileViewerChrome.ts'
import type { FileInspectResult } from '../../../shared/ipc.ts'

const copy = {
  loading: 'Loading',
  zipEntries: (n: number) => `${n} entries`,
  zipRatio: (n: number) => `${n}%`,
  csvSheet: (rows: number, cols: number) => `${rows}×${cols}`,
  csvSheetCapped: (shown: number, total: number, cols: number) => `${shown}/${total}×${cols}`,
  lines: (n: number) => `${n} lines`,
  modifiedAt: (when: string) => `mod ${when}`
}

function inspect(over: Partial<FileInspectResult> & Pick<FileInspectResult, 'kind'>): FileInspectResult {
  return {
    path: '/a',
    name: 'a',
    size: 10,
    mime: 'text/plain',
    ...over
  }
}

describe('fileViewerStatusLeft', () => {
  it('uses the loading label before inspect returns', () => {
    assert.equal(
      fileViewerStatusLeft({
        info: null,
        badge: 'TS',
        filePath: '/a.ts',
        hasUnsavedChanges: false,
        csvModel: null,
        copy,
        formatDate: () => 'Jan 1'
      }),
      'Loading'
    )
  })

  it('summarizes a zip archive', () => {
    const text = fileViewerStatusLeft({
      info: inspect({
        kind: 'zip',
        zip: {
          entries: [],
          entryCount: 3,
          compressedSize: 100,
          uncompressedSize: 200,
          ratio: 50
        }
      }),
      badge: 'ZIP',
      filePath: '/pack.zip',
      hasUnsavedChanges: true,
      csvModel: null,
      copy,
      formatDate: () => 'Jan 1'
    })
    assert.match(text, /3 entries/)
    assert.match(text, /ZIP/)
    assert.equal(text.includes('•'), false)
  })

  it('summarizes a binary file without a dirty mark', () => {
    const text = fileViewerStatusLeft({
      info: inspect({ kind: 'binary', size: 2048, mtimeMs: 1 }),
      badge: 'BIN',
      filePath: '/a.bin',
      hasUnsavedChanges: true,
      csvModel: null,
      copy,
      formatDate: () => 'Jan 1'
    })
    assert.match(text, /BIN/)
    assert.match(text, /mod Jan 1/)
    assert.equal(text.includes('•'), false)
  })

  it('summarizes a csv sheet and a capped window', () => {
    const full = fileViewerStatusLeft({
      info: inspect({ kind: 'csv', size: 40 }),
      badge: 'CSV',
      filePath: '/a.csv',
      hasUnsavedChanges: false,
      csvModel: { rows: [[], []], totalRows: 2, headers: ['a', 'b'] },
      copy,
      formatDate: () => 'Jan 1'
    })
    assert.match(full, /2×2/)
    const capped = fileViewerStatusLeft({
      info: inspect({ kind: 'csv', size: 40 }),
      badge: 'CSV',
      filePath: '/a.csv',
      hasUnsavedChanges: false,
      csvModel: {
        rowCapped: true,
        rows: [[]],
        totalRows: 100,
        headers: ['a']
      },
      copy,
      formatDate: () => 'Jan 1'
    })
    assert.match(capped, /1\/100×1/)
  })

  it('appends a dirty mark for text files', () => {
    const text = fileViewerStatusLeft({
      info: inspect({ kind: 'text', lineCount: 4, size: 12 }),
      badge: 'TS',
      filePath: '/a.ts',
      hasUnsavedChanges: true,
      csvModel: null,
      copy,
      formatDate: () => 'Jan 1'
    })
    assert.ok(text.endsWith('•'))
    assert.match(text, /4 lines/)
  })
})

describe('fileViewerShortcut', () => {
  const base = {
    hasUnsavedChanges: false,
    effectiveReadOnly: false,
    hasSelectionOrCards: false,
    agentPanelOpen: false,
    embedded: false
  }

  it('maps save / close / escape', () => {
    assert.equal(fileViewerShortcut({ ...base, metaOrCtrl: true, key: 'w', shift: false }), 'close')
    assert.equal(
      fileViewerShortcut({ ...base, metaOrCtrl: true, key: 's', shift: true, hasUnsavedChanges: false }),
      'save-as'
    )
    assert.equal(
      fileViewerShortcut({ ...base, metaOrCtrl: true, key: 's', shift: false, hasUnsavedChanges: true }),
      'save'
    )
    assert.equal(
      fileViewerShortcut({ ...base, metaOrCtrl: true, key: 's', shift: false, hasUnsavedChanges: false }),
      'save-consume'
    )
    assert.equal(
      fileViewerShortcut({ ...base, metaOrCtrl: false, key: 'Escape', shift: false, hasSelectionOrCards: true }),
      'clear-selection'
    )
    assert.equal(
      fileViewerShortcut({ ...base, metaOrCtrl: false, key: 'Escape', shift: false, agentPanelOpen: true }),
      'toggle-agent'
    )
    assert.equal(
      fileViewerShortcut({ ...base, metaOrCtrl: false, key: 'Escape', shift: false }),
      'close-window'
    )
    assert.equal(
      fileViewerShortcut({ ...base, metaOrCtrl: false, key: 'Escape', shift: false, embedded: true }),
      null
    )
  })
})
