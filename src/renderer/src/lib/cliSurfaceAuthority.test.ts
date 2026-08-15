import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  acceptSessionNavigateSeq,
  isCliSurfaceLocked,
  resolveHydratedCliMode
} from './cliSurfaceAuthority.ts'

describe('resolveHydratedCliMode', () => {
  it('takes remote CLI when the companion is in Swarm', () => {
    assert.equal(
      resolveHydratedCliMode({ remoteCli: true, localCli: false, followRemote: true }),
      true
    )
  })

  it('demotes parked / reclaim main when the companion is on Thread', () => {
    assert.equal(
      resolveHydratedCliMode({ remoteCli: false, localCli: true, followRemote: true }),
      false
    )
  })

  it('does not demote the writing window on a stale remote false', () => {
    assert.equal(
      resolveHydratedCliMode({ remoteCli: false, localCli: true, followRemote: false }),
      true
    )
  })

  it('keeps local when remote has not written the flag yet', () => {
    assert.equal(
      resolveHydratedCliMode({ remoteCli: undefined, localCli: true, followRemote: true }),
      true
    )
  })
})

describe('isCliSurfaceLocked', () => {
  it('locks main when the conversation is detached', () => {
    assert.equal(isCliSurfaceLocked('c1', ['c1'], false), true)
  })

  it('never locks the companion shell', () => {
    assert.equal(isCliSurfaceLocked('c1', ['c1'], true), false)
  })

  it('leaves main unlocked when the session is here', () => {
    assert.equal(isCliSurfaceLocked('c1', ['c2'], false), false)
  })
})

describe('acceptSessionNavigateSeq', () => {
  it('rejects a park that is older than the claim already applied', () => {
    assert.deepEqual(acceptSessionNavigateSeq(6, 5), { accept: false, seq: 6 })
  })

  it('accepts a newer claim or park', () => {
    assert.deepEqual(acceptSessionNavigateSeq(5, 6), { accept: true, seq: 6 })
  })

  it('accepts a payload with no seq', () => {
    assert.deepEqual(acceptSessionNavigateSeq(3, undefined), { accept: true, seq: 3 })
  })
})
