import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  parseRemoteFolderPickRequest,
  remoteFolderWindowPosition,
  REMOTE_FOLDER_WINDOW_HEIGHT
} from './remoteFolderView.ts'

describe('remoteFolderView', () => {
  it('parses a pick request and defaults purpose', () => {
    assert.deepEqual(parseRemoteFolderPickRequest({ conversationId: 'c1', machineId: ' host-1 ' }), {
      conversationId: 'c1',
      machineId: 'host-1',
      purpose: 'workdir'
    })
    assert.equal(parseRemoteFolderPickRequest({ machineId: '' }), null)
    assert.equal(parseRemoteFolderPickRequest(null), null)
    assert.equal(
      parseRemoteFolderPickRequest({ conversationId: 'c1', machineId: 'h', purpose: 'locate' })
        ?.purpose,
      'locate'
    )
  })

  it('centers on the parent and stays inside the work area', () => {
    const placed = remoteFolderWindowPosition({
      width: 640,
      height: REMOTE_FOLDER_WINDOW_HEIGHT,
      parent: { x: 100, y: 80, width: 1200, height: 800 },
      workArea: { x: 0, y: 25, width: 1440, height: 875 }
    })
    assert.equal(placed.x, 100 + Math.round((1200 - 640) / 2))
    assert.equal(placed.y, 80 + Math.round((800 - REMOTE_FOLDER_WINDOW_HEIGHT) / 2))
  })

  it('clamps a dialog that would sit off-screen', () => {
    const placed = remoteFolderWindowPosition({
      width: 640,
      height: 480,
      parent: { x: 2000, y: 2000, width: 100, height: 100 },
      workArea: { x: 0, y: 0, width: 800, height: 600 }
    })
    assert.equal(placed.x, 800 - 640 - 8)
    assert.equal(placed.y, 600 - 480 - 8)
  })
})
