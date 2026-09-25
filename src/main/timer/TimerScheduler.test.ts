import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConversationStore } from '../store/ConversationStore.ts'
import { TimerStore } from '../store/TimerStore.ts'
import { TimerScheduler, timerRunDestination, timerTurnPrompt } from './TimerScheduler.ts'

function harness(opts?: { defer?: boolean }): {
  store: TimerStore
  scheduler: TimerScheduler
  ran: string[]
  watched: Array<{ id: string; workdir: string }>
} {
  const dir = mkdtempSync(join(tmpdir(), 'vav-sched-'))
  const store = new TimerStore(dir)
  store.load()
  const conversations = new ConversationStore(dir)
  conversations.load({ model: 'test', mintWorkdir: () => dir })
  const ran: string[] = []
  const watched: Array<{ id: string; workdir: string }> = []
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
    shouldDefer: opts?.defer ? () => true : undefined,
    watchWorkdir: (id, workdir) => {
      watched.push({ id, workdir })
    }
  })
  return { store, scheduler, ran, watched }
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
    assert.equal(live.watched.length, 1)
    assert.equal(live.watched[0]?.id, live.ran[0])
    assert.ok(live.watched[0]?.workdir)
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

  it('copies provider, model, and run options from the definition conversation', () => {
    const { store, scheduler } = harness()
    const conversations = (
      scheduler as unknown as {
        deps: { conversations: ConversationStore }
      }
    ).deps.conversations
    const definition = conversations.create('/tmp/sched-def', 'claude-sonnet', {
      sessionKind: 'timer',
      title: 'Nightly',
      cliHost: 'claude',
      thinkingLevel: 'low',
      fast: true,
      accountId: 'acc-1'
    })
    const job = store.createJob({
      title: 'Nightly',
      prompt: 'Write a note',
      schedule: { kind: 'interval', everyMs: 60_000 },
      conversationId: definition.id
    })
    const fired = scheduler.fire(job)
    assert.ok(fired)
    const run = conversations.get(fired.conversationId)
    assert.equal(run?.model, 'claude-sonnet')
    assert.equal(run?.cliHost, 'claude')
    assert.equal(run?.thinkingLevel, 'low')
    assert.equal(run?.fast, true)
    assert.equal(run?.accountId, 'acc-1')
    assert.equal(run?.approvalMode, 'bypass')
  })

  it('inherits cliHost from the definition conversation when the job only pinned a model', () => {
    const { store, scheduler } = harness()
    const conversations = (
      scheduler as unknown as {
        deps: { conversations: ConversationStore }
      }
    ).deps.conversations
    const definition = conversations.create('/tmp/sched-def', 'cursor-grok-4.6-xhigh', {
      sessionKind: 'timer',
      cliHost: 'cursor'
    })
    const job = store.createJob({
      title: 'Nightly',
      prompt: 'Write a note',
      schedule: { kind: 'interval', everyMs: 60_000 },
      conversationId: definition.id,
      model: 'cursor-grok-4.6-xhigh'
    })
    const fired = scheduler.fire(job)
    assert.ok(fired)
    const run = conversations.get(fired.conversationId)
    assert.equal(run?.model, 'cursor-grok-4.6-xhigh')
    assert.equal(run?.cliHost, 'cursor')
  })

  it('prefers the job agent settings over the definition conversation', () => {
    const { store, scheduler } = harness()
    const conversations = (
      scheduler as unknown as {
        deps: { conversations: ConversationStore }
      }
    ).deps.conversations
    const definition = conversations.create('/tmp/sched-def', 'old-model', {
      sessionKind: 'timer',
      cliHost: 'claude'
    })
    const job = store.createJob({
      title: 'Nightly',
      prompt: 'Write a note',
      schedule: { kind: 'interval', everyMs: 60_000 },
      conversationId: definition.id,
      model: 'grok-4.3',
      cliHost: 'cursor',
      thinkingLevel: 'medium',
      fast: false,
      accountId: 'cursor-acc'
    })
    const fired = scheduler.fire(job)
    assert.ok(fired)
    const run = conversations.get(fired.conversationId)
    assert.equal(run?.model, 'grok-4.3')
    assert.equal(run?.cliHost, 'cursor')
    assert.equal(run?.thinkingLevel, 'medium')
    assert.equal(run?.fast, false)
    assert.equal(run?.accountId, 'cursor-acc')
  })

  it('asks the run to follow the task destination instead of output.md', () => {
    const prompt = timerTurnPrompt({
      id: 'j',
      title: 'Digest',
      prompt: 'Summarize deploys',
      schedule: { kind: 'interval', everyMs: 60_000 },
      enabled: true,
      conversationId: null,
      workdirPolicy: 'mint',
      sourceWorkdir: null,
      connectorIds: [],
      model: null,
      cliHost: null,
      accountId: null,
      thinkingLevel: null,
      fast: false,
      createdAt: 1,
      updatedAt: 1,
      lastRunAt: null,
      nextRunAt: null,
      lastStatus: null
    })
    assert.match(prompt, /note_write/)
    assert.match(prompt, /analysis_write/)
    assert.match(prompt, /schedule_write/)
    assert.match(prompt, /storage_write/)
    assert.match(prompt, /Do not create output\.md unless the task names that file/)
    assert.doesNotMatch(prompt, /write a Markdown report to output\.md/)
  })

  it('records a note URL and does not invent output.md', () => {
    const { store, scheduler } = harness()
    const now = 5_000
    const job = store.createJob(
      {
        title: 'Digest',
        prompt: 'Write a note',
        schedule: { kind: 'once', at: now }
      },
      now - 1
    )
    const fired = scheduler.fire(job, now)
    assert.ok(fired)
    const conversation = store.listRuns(job.id)[0]
    assert.ok(conversation)
    const conversations = (
      scheduler as unknown as { deps: { conversations: { get: (id: string) => { messages: unknown[]; activeLeafId: string | null }; appendMessage: (id: string, message: unknown) => void } } }
    ).deps.conversations
    conversations.appendMessage(fired.conversationId, {
      id: 'a1',
      parentId: null,
      role: 'assistant',
      content: 'saved',
      createdAt: now,
      blocks: [
        {
          kind: 'toolCall',
          id: 't1',
          tool: 'note_write',
          summary: 'Launch',
          input: '{}',
          output: 'Created note “Launch”\nvav://app/knowledge?id=n1',
          status: 'completed'
        }
      ]
    })
    scheduler.onTurnEnd(fired.conversationId)
    const run = store.getRun(fired.runId)
    assert.equal(run?.outputPath, 'vav://app/knowledge?id=n1')
    assert.equal(existsSync(join(run!.workdir, 'output.md')), false)
    assert.equal(
      timerRunDestination(conversations.get(fired.conversationId).messages as never, 'a1'),
      'vav://app/knowledge?id=n1'
    )
  })
})
