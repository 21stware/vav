import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConversationStore } from '../store/ConversationStore.ts'
import { TimerStore } from '../store/TimerStore.ts'
import { TimerScheduler } from './TimerScheduler.ts'

function harness(opts?: { defer?: boolean }): {
  store: TimerStore
  scheduler: TimerScheduler
  ran: string[]
} {
  const dir = mkdtempSync(join(tmpdir(), 'vav-sched-'))
  const store = new TimerStore(dir)
  store.load()
  const conversations = new ConversationStore(dir)
  conversations.load({ model: 'test', mintWorkdir: () => dir })
  const ran: string[] = []
  const scheduler = new TimerScheduler({
    store,
    conversations,
    tmp: dir,
    defaultModel: () => 'test',
    runTurn: (id) => {
      ran.push(id)
    },
    isRunning: () => false,
    reload: () => store.load(),
    shouldDefer: opts?.defer ? () => true : undefined
  })
  return { store, scheduler, ran }
}

describe('TimerScheduler', () => {
  it('skips an empty prompt and defers when another host owns the clock', async () => {
    const { store, scheduler, ran } = harness({ defer: true })
    const now = 1_000_000
    store.createJob(
      {
        title: 'Empty',
        prompt: '',
        schedule: { kind: 'once', at: now }
      },
      now - 1
    )
    await scheduler.tick(now)
    assert.deepEqual(ran, [])

    const live = harness()
    live.store.createJob(
      {
        title: 'Ready',
        prompt: 'Check deploys',
        schedule: { kind: 'once', at: now }
      },
      now - 1
    )
    await live.scheduler.tick(now)
    assert.equal(live.ran.length, 1)
  })

  it('reuses a sticky workspace and a source folder, and mints a new one each run', () => {
    const { store, scheduler } = harness()
    const sticky = store.createJob({
      title: 'Sticky',
      prompt: 'Write a note',
      schedule: { kind: 'interval', everyMs: 60_000 },
      workdirPolicy: 'sticky'
    })
    const first = scheduler.fire(sticky, 1_000)
    const second = scheduler.fire(sticky, 2_000)
    assert.ok(first && second)
    const stickyRuns = store.listRuns(sticky.id)
    assert.equal(stickyRuns[0]?.workdir, stickyRuns[1]?.workdir)

    const sourceDir = join(store.listRuns(sticky.id)[0]!.workdir, '..', 'picked')
    mkdirSync(sourceDir, { recursive: true })
    const sourced = store.createJob({
      title: 'Source',
      prompt: 'Write a note',
      schedule: { kind: 'interval', everyMs: 60_000 },
      workdirPolicy: 'source',
      sourceWorkdir: sourceDir
    })
    const sourcedRun = scheduler.fire(sourced, 3_000)
    assert.ok(sourcedRun)
    assert.equal(store.listRuns(sourced.id)[0]?.workdir, sourceDir)

    const minted = store.createJob({
      title: 'Mint',
      prompt: 'Write a note',
      schedule: { kind: 'interval', everyMs: 60_000 },
      workdirPolicy: 'mint'
    })
    scheduler.fire(minted, 4_000)
    scheduler.fire(minted, 5_000)
    const mintedRuns = store.listRuns(minted.id)
    assert.notEqual(mintedRuns[0]?.workdir, mintedRuns[1]?.workdir)
  })
})
