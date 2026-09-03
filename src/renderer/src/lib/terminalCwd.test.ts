import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cwdFromSliceOrMeta } from './terminalCwd.ts'

const local = (id: string | null | undefined) => !id || id === 'local'

describe('cwdFromSliceOrMeta', () => {
  it('prefers a real slice root, then conversation workdir', () => {
    assert.equal(
      cwdFromSliceOrMeta({
        sliceRoot: '/proj',
        workingDirectory: '/other',
        isLocalMachine: local
      }),
      '/proj'
    )
    assert.equal(
      cwdFromSliceOrMeta({
        sliceRoot: '~',
        workingDirectory: '/meta',
        isLocalMachine: local
      }),
      '/meta'
    )
  })

  it('falls back to settings home for local, host home for remote', () => {
    assert.equal(
      cwdFromSliceOrMeta({
        sliceRoot: null,
        workingDirectory: '~',
        machineId: 'local',
        defaultWorkingDirectory: ' /home/me ',
        isLocalMachine: local
      }),
      '/home/me'
    )
    assert.equal(
      cwdFromSliceOrMeta({
        sliceRoot: null,
        workingDirectory: null,
        machineId: 'host-1',
        hostHome: '/Users/remote',
        isLocalMachine: local
      }),
      '/Users/remote'
    )
  })
})
