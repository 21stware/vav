import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { raceSettle, withTimeout } from './asyncTimeout.ts'

describe('asyncTimeout', () => {
  it('resolves when work finishes in time', async () => {
    assert.equal(await withTimeout(Promise.resolve(7), 50), 7)
    const settled = await raceSettle(Promise.resolve('ok'), 50)
    assert.deepEqual(settled, { timedOut: false, value: 'ok' })
  })

  it('settles a hung refresh so the UI can leave Syncing', async () => {
    const hung = new Promise<string>(() => undefined)
    const settled = await raceSettle(hung, 20)
    assert.equal(settled.timedOut, true)
  })
})
