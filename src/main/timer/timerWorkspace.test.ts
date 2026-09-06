import assert from 'node:assert/strict'
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { mintTimerWorkspace } from './timerWorkspace.ts'

describe('mintTimerWorkspace', () => {
  it('creates a stamped Workspace folder under timers/jobId', () => {
    const root = mkdtempSync(join(tmpdir(), 'vav-timer-ws-'))
    const at = new Date(2026, 8, 6, 9, 30, 0).getTime()
    const dir = mintTimerWorkspace(root, 'job-a', at)
    assert.equal(dir, join(root, 'timers', 'job-a', '20260906-093000', 'Workspace'))
    assert.equal(existsSync(dir), true)
  })
})
