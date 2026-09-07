import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TimerStore } from './TimerStore.ts'

function store(): TimerStore {
  const dir = mkdtempSync(join(tmpdir(), 'vav-timers-'))
  const next = new TimerStore(dir)
  next.load()
  return next
}

describe('TimerStore', () => {
  it('creates, persists, and lists jobs out of the main conversation stream', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-timers-'))
    const a = new TimerStore(dir)
    a.load()
    const job = a.createJob({
      title: 'Morning check',
      prompt: 'Check Cloudflare deploys',
      schedule: { kind: 'interval', everyMs: 60_000 },
      connectorIds: ['cloudflare']
    })
    assert.equal(job.enabled, true)
    assert.ok(job.nextRunAt)
    const b = new TimerStore(dir)
    b.load()
    assert.equal(b.getJob(job.id)?.title, 'Morning check')
    assert.deepEqual(b.getJob(job.id)?.connectorIds, ['cloudflare'])
    assert.equal(b.getJob(job.id)?.conversationId, null)
  })

  it('allows an empty prompt and binds a definition conversation', () => {
    const timers = store()
    const job = timers.createJob({
      title: '',
      prompt: '',
      schedule: { kind: 'interval', everyMs: 60_000 },
      conversationId: 'conv-def'
    })
    assert.equal(job.title, 'Scheduled task')
    assert.equal(job.prompt, '')
    assert.equal(job.conversationId, 'conv-def')
    assert.equal(timers.getJobForConversation('conv-def')?.id, job.id)
  })

  it('marks due jobs and finishes a run', () => {
    const timers = store()
    const now = 1_000_000
    const job = timers.createJob(
      {
        title: 'Once',
        prompt: 'Write a note',
        schedule: { kind: 'once', at: now }
      },
      now - 1
    )
    assert.equal(timers.dueJobs(now).map((row) => row.id).join(), job.id)
    const run = timers.beginRun({
      jobId: job.id,
      conversationId: 'conv-1',
      workdir: '/tmp/ws',
      now
    })
    assert.ok(run)
    assert.equal(timers.getJob(job.id)?.lastStatus, 'running')
    timers.finishRun(run!.id, { status: 'done', outputPath: '/tmp/ws/output.md' }, now + 10)
    const finished = timers.getRun(run!.id)
    assert.equal(finished?.status, 'done')
    assert.equal(timers.getJob(job.id)?.enabled, false)
    assert.equal(timers.getJob(job.id)?.lastStatus, 'ok')
  })

  it('rejects invalid schedules', () => {
    const timers = store()
    assert.throws(() =>
      timers.createJob({
        title: 'Bad',
        prompt: 'x',
        schedule: { kind: 'cron', expr: 'nope' }
      })
    )
  })
})
