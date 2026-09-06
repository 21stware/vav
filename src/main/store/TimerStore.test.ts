import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { TimerStore } from './TimerStore.ts'

describe('TimerStore', () => {
  it('persists jobs, marks due, and records runs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-timer-store-'))
    const store = new TimerStore(dir)
    store.bind({ get: () => undefined } as never)

    const job = store.upsertJob({ title: 'Ping', prompt: 'say hi', everyMinutes: 1 })
    assert.equal(store.listJobs().length, 1)
    assert.equal(job.nextRunAt, job.createdAt)
    assert.deepEqual(
      store.dueJobs(job.createdAt!).map((row) => row.id),
      [job.id]
    )

    const run = store.beginRun({
      jobId: job.id,
      sessionId: 'sess-1',
      workdir: '/tmp/ws',
      at: job.createdAt! + 10
    })
    assert.equal(store.isJobRunning(job.id), true)
    store.finishRun(run.id, 'done', '/tmp/ws/OUTPUT.md')
    assert.equal(store.isJobRunning(job.id), false)

    const rows = store.listSessions()
    assert.equal(rows.length, 1)
    assert.equal(rows[0]?.sessionId, 'sess-1')
    assert.equal(rows[0]?.status, 'done')
    assert.equal(rows[0]?.outputPath, '/tmp/ws/OUTPUT.md')

    const reloaded = new TimerStore(dir)
    reloaded.bind({ get: () => undefined } as never)
    assert.equal(reloaded.listJobs()[0]?.title, 'Ping')
    assert.equal(reloaded.listSessions()[0]?.status, 'done')
  })
})
