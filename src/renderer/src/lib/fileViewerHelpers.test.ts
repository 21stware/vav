import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyFileDraftContent,
  blockToRef,
  clampPanelWidth,
  collectBlocks,
  countNewlinesLocal,
  filesHostConversationId,
  formatCommentCardLabel,
  isOpenFilePath,
  isSilentPreviewWindowWarning,
  loadPanelWidth,
  mergeIncomingTextBody,
  mergeTextWindowInspect,
  nextCommentCardsOnBlockPick,
  pathIsUnderWorkspaceRoot,
  pathsEqual,
  persistPanelWidth,
  provisionalInspect,
  selectedBlockIdsForPath,
  upsertCommentCard,
  bindFilePreviewWorkspace,
  fileViewerAgentPanelOpen,
  previewBlocksFromSqliteTables,
  previewBlocksFromZipEntries
} from './fileViewerHelpers.ts'
import type { PreviewBlock } from './previewBlocks.ts'

describe('pathsEqual', () => {
  it('treats trailing slashes and ASCII case as the same path', () => {
    assert.equal(pathsEqual('/Tmp/A', '/tmp/a/'), true)
    assert.equal(pathsEqual('/tmp/a', '/tmp/b'), false)
  })
})

describe('applyFileDraftContent', () => {
  it('replaces, appends when baseLen matches, and ignores a stale append', () => {
    assert.equal(applyFileDraftContent('old', { content: 'next' }), 'next')
    assert.equal(applyFileDraftContent('ab', { append: 'c', baseLen: 2 }), 'abc')
    assert.equal(applyFileDraftContent('ab', { append: 'c', baseLen: 1 }), 'ab')
  })
})

describe('mergeIncomingTextBody / mergeTextWindowInspect', () => {
  it('keeps a longer draft that still starts with the truncated prefix', () => {
    assert.equal(mergeIncomingTextBody('abcdef', 'abc', true), 'abcdef')
    assert.equal(mergeIncomingTextBody('abx', 'abc', true), 'abc')
    assert.equal(mergeIncomingTextBody('abcdef', 'abc', false), 'abc')
  })

  it('appends a text window onto the matching inspect snapshot', () => {
    const prev = {
      path: '/a.ts',
      name: 'a.ts',
      kind: 'text' as const,
      mime: 'text/plain',
      size: 10,
      text: 'ab',
      truncated: true,
      textWindow: { startByte: 0, endByte: 2, totalBytes: 4 }
    }
    const next = mergeTextWindowInspect(prev, '/a.ts', 'cd', {
      truncated: false,
      endByte: 4,
      totalBytes: 4
    })
    assert.equal(next?.text, 'abcd')
    assert.equal(next?.truncated, false)
    assert.equal(next?.textWindow?.endByte, 4)
    assert.equal(next?.lineCount, 1)
    assert.equal(
      mergeTextWindowInspect(prev, '/other.ts', 'cd', {
        truncated: false,
        endByte: 4,
        totalBytes: 4
      }),
      prev
    )
  })
})

describe('comment-card pick', () => {
  it('cancels a re-click and drops empty notes when adding a new pick', () => {
    const a = {
      id: '/f.ts::a',
      filePath: '/f.ts',
      label: 'a',
      startLine: 1,
      endLine: 1,
      text: 'a'
    }
    const b = {
      id: '/f.ts::b',
      filePath: '/f.ts',
      label: 'b',
      startLine: 2,
      endLine: 2,
      text: 'b'
    }
    const existing = [
      { ref: a, comment: '' },
      { ref: { ...a, id: '/other.ts::x' }, comment: 'keep' }
    ]
    const cancelled = nextCommentCardsOnBlockPick(existing, '/f.ts', 'a', a)
    assert.equal(cancelled.cancelled, true)
    assert.deepEqual(cancelled.selectedIds, [])
    const added = nextCommentCardsOnBlockPick(existing, '/f.ts', 'b', b)
    assert.equal(added.cancelled, false)
    assert.deepEqual(added.selectedIds, ['b'])
    assert.equal(added.cards.length, 2)
    assert.deepEqual(selectedBlockIdsForPath(added.cards, '/f.ts'), ['b'])
  })
})

describe('upsertCommentCard', () => {
  it('replaces the matching ref and appends otherwise', () => {
    const a = {
      id: '/f.ts::a',
      filePath: '/f.ts',
      label: 'a',
      startLine: 1,
      endLine: 1,
      text: 'a'
    }
    const b = {
      id: '/f.ts::b',
      filePath: '/f.ts',
      label: 'b',
      startLine: 2,
      endLine: 2,
      text: 'b'
    }
    const existing = [{ ref: a, comment: 'keep-other' }]
    const next = upsertCommentCard(existing, b)
    assert.equal(next.length, 2)
    assert.equal(next[1]!.ref.id, '/f.ts::b')
    const replaced = upsertCommentCard(next, a)
    assert.equal(replaced.length, 2)
    assert.equal(replaced.find((c) => c.ref.id === '/f.ts::a')?.comment, '')
  })
})

describe('formatCommentCardLabel / collectBlocks / newlines', () => {
  it('labels line picks and flattens nested blocks', () => {
    const child: PreviewBlock = {
      id: 'c',
      kind: 'paragraph',
      text: 'x',
      startLine: 2,
      endLine: 4
    }
    const parent: PreviewBlock = {
      id: 'line-L10',
      kind: 'line',
      text: 'y',
      startLine: 10,
      endLine: 10,
      children: [child]
    }
    assert.equal(formatCommentCardLabel(parent), 'line 10')
    assert.equal(formatCommentCardLabel(child), 'paragraph · lines 2–4')
    assert.deepEqual(
      collectBlocks([parent]).map((b) => b.id),
      ['line-L10', 'c']
    )
    assert.equal(countNewlinesLocal('a\nb\n'), 2)
    assert.equal(blockToRef('/a.ts', 'ts', child).label, 'paragraph · lines 2–4')
    assert.equal(blockToRef('/a.ts', 'ts', child).id, '/a.ts::c')
  })
})

describe('isSilentPreviewWindowWarning / provisionalInspect', () => {
  it('hides windowing notices and guesses office kinds from the path', () => {
    assert.equal(isSilentPreviewWindowWarning('truncated to 48 x 120'), true)
    assert.equal(isSilentPreviewWindowWarning('Sheet Sheet1 truncated'), true)
    assert.equal(isSilentPreviewWindowWarning('password protected'), false)
    assert.equal(provisionalInspect('/docs/a.pdf')?.kind, 'pdf')
    assert.equal(provisionalInspect('/docs/a.ts'), null)
    assert.equal(provisionalInspect('/docs/pack.zip')?.kind, 'zip')
    assert.equal(provisionalInspect('/docs/pic.png')?.kind, 'image')
    assert.equal(provisionalInspect('/docs/blob.bin'), null)
  })
})

describe('filesHostConversationId / panel width', () => {
  it('prefers agent, then parent, then the sidebar fallback', () => {
    assert.equal(filesHostConversationId('a', 'p', 'active'), 'a')
    assert.equal(filesHostConversationId(null, 'p', 'active'), 'p')
    assert.equal(filesHostConversationId(null, null, 'active'), 'active')
    assert.equal(filesHostConversationId(null, null, null), undefined)
  })

  it('loads, clamps, and persists the agent panel width', () => {
    const store: Record<string, string> = {}
    assert.equal(loadPanelWidth(() => null), 360)
    assert.equal(loadPanelWidth((key) => (key === 'vav.filePreviewAgentPanelWidth' ? '400' : null)), 400)
    assert.equal(loadPanelWidth(() => '100'), 360)
    assert.equal(clampPanelWidth(100), 280)
    assert.equal(clampPanelWidth(900), 520)
    persistPanelWidth(320, (key, value) => {
      store[key] = value
    })
    assert.equal(store['vav.filePreviewAgentPanelWidth'], '320')
  })
})

describe('bindFilePreviewWorkspace', () => {
  it('only highlights a path already under the session root', async () => {
    const selected: string[] = []
    const bound = await bindFilePreviewWorkspace({
      conversationId: 'c1',
      path: '/repo/src/a.ts',
      dir: '/repo/src',
      workingDirectory: '/repo',
      toolsCollapsed: () => true,
      selectPath: (_id, path) => selected.push(path),
      setConversationWorkingDirectory: async () => {
        throw new Error('should not shrink')
      },
      setWorkspaceWorkingDirectory: async () => {
        throw new Error('should not shrink')
      },
      setPanelSegmentQuiet: () => undefined,
      setToolsCollapsed: () => undefined,
      markEnclosedDirChip: () => undefined
    })
    assert.equal(bound, 'select-only')
    assert.deepEqual(selected, ['/repo/src/a.ts'])
    assert.equal(pathIsUnderWorkspaceRoot('/repo/src/a.ts', '/repo'), true)
    assert.equal(pathIsUnderWorkspaceRoot('/repo/src/a.ts', '__tmp'), false)
  })

  it('binds the enclosed directory when the session has no project root', async () => {
    const calls: string[] = []
    const bound = await bindFilePreviewWorkspace({
      conversationId: 'c1',
      path: '/tmp/notes.md',
      dir: '/tmp',
      workingDirectory: null,
      toolsCollapsed: () => true,
      selectPath: () => calls.push('select'),
      setConversationWorkingDirectory: async (_id, dir) => {
        calls.push(`conv:${dir}`)
      },
      setWorkspaceWorkingDirectory: async () => {
        throw new Error('session workdir should change')
      },
      setPanelSegmentQuiet: (seg) => calls.push(`seg:${seg}`),
      setToolsCollapsed: (on) => calls.push(`collapse:${on}`),
      markEnclosedDirChip: (id) => calls.push(`chip:${id}`)
    })
    assert.equal(bound, 'bound')
    assert.deepEqual(calls, ['conv:/tmp', 'select', 'seg:files', 'collapse:true', 'chip:c1'])
  })
})

describe('isOpenFilePath', () => {
  it('matches the real path or either side of a working copy', async () => {
    assert.equal(await isOpenFilePath('/a.ts', '/a.ts'), true)
    assert.equal(await isOpenFilePath('/a.ts', '/b.ts'), false)
    assert.equal(
      await isOpenFilePath('/real.ts', '/copy.ts', async () => ({
        realPath: '/real.ts',
        copyPath: '/copy.ts'
      })),
      true
    )
  })
})

describe('fileViewerAgentPanelOpen', () => {
  it('keeps standalone local, and treats untoggled embedded as open', () => {
    assert.equal(
      fileViewerAgentPanelOpen({ embedded: false, hasToggle: false, localOpen: true }),
      true
    )
    assert.equal(
      fileViewerAgentPanelOpen({
        embedded: true,
        hasToggle: true,
        propOpen: false,
        localOpen: true
      }),
      false
    )
    assert.equal(
      fileViewerAgentPanelOpen({ embedded: true, hasToggle: false, localOpen: false }),
      true
    )
  })
})

describe('previewBlocksFromSqliteTables / previewBlocksFromZipEntries', () => {
  it('builds table stubs and ZIP directory vs file blocks', () => {
    const tables = previewBlocksFromSqliteTables([
      { name: 'users', columns: ['id', 'name'], rowCount: 3 }
    ])
    assert.equal(tables[0]?.id, 'db-table-users')
    assert.equal(tables[0]?.kind, 'table')
    assert.equal(tables[0]?.startLine, 0)
    assert.match(tables[0]?.text ?? '', /TABLE users/)

    const zip = previewBlocksFromZipEntries([
      { path: 'src/', isDirectory: true },
      { path: 'src/a.ts', isDirectory: false }
    ])
    assert.equal(zip[0]?.kind, 'section')
    assert.equal(zip[0]?.startLine, 0)
    assert.equal(zip[0]?.text, 'DIR src/')
    assert.equal(zip[1]?.kind, 'code')
    assert.equal(zip[1]?.text, 'FILE src/a.ts')
  })
})
