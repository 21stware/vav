import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
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
})
