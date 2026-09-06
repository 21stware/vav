import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mintTimerWorkdir } from './mintTimerWorkdir.ts'

describe('mintTimerWorkdir', () => {
  it('creates a timestamped Workspace under tmp/vav/timer', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'vav-timer-ws-'))
    const dir = mintTimerWorkdir(tmp, 'abcdef12-job', Date.parse('2026-09-06T09:08:07'))
    assert.ok(existsSync(dir))
    assert.match(dir.replaceAll('\\', '/'), /\/vav\/timer\/abcdef12\/\d{8}-\d{6}\/Workspace$/)
  })
})
