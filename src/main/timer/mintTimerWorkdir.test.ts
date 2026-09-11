import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mintTimerWorkdir, resolveTimerWorkdir, stickyTimerWorkdir } from './mintTimerWorkdir.ts'

describe('mintTimerWorkdir', () => {
  it('creates a timestamped Workspace under tmp/vav/timer', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'vav-timer-ws-'))
    const dir = mintTimerWorkdir(tmp, 'abcdef12-job', Date.parse('2026-09-06T09:08:07'))
    assert.ok(existsSync(dir))
    assert.match(dir.replaceAll('\\', '/'), /\/vav\/timer\/abcdef12\/\d{8}-\d{6}\/Workspace$/)
  })

  it('reuses one sticky Workspace and honors a source folder', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'vav-timer-ws-'))
    const jobId = 'abcdef12-job'
    const sticky = stickyTimerWorkdir(tmp, jobId)
    assert.equal(stickyTimerWorkdir(tmp, jobId), sticky)
    assert.match(sticky.replaceAll('\\', '/'), /\/vav\/timer\/abcdef12\/Workspace$/)

    const source = join(tmp, 'picked')
    mkdirSync(source)
    assert.equal(
      resolveTimerWorkdir({ id: jobId, workdirPolicy: 'source', sourceWorkdir: source }, tmp, 1),
      source
    )
    assert.equal(
      resolveTimerWorkdir({ id: jobId, workdirPolicy: 'sticky', sourceWorkdir: null }, tmp, 1),
      sticky
    )
    const minted = resolveTimerWorkdir(
      { id: jobId, workdirPolicy: 'mint', sourceWorkdir: null },
      tmp,
      Date.parse('2026-09-06T09:08:07')
    )
    assert.notEqual(minted, sticky)
    assert.match(minted.replaceAll('\\', '/'), /\/vav\/timer\/abcdef12\/\d{8}-\d{6}\/Workspace$/)
  })
})
