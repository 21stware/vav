import assert from 'node:assert/strict'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { ConversationStore } from '../store/ConversationStore.ts'
import { TimerStore } from '../store/TimerStore.ts'
import { TimerScheduler } from './TimerScheduler.ts'
import { VAV_DEFAULT_MODEL_ID } from '@shared/types'

describe('TimerScheduler', () => {
  it('mints a timer session + timestamped workspace and writes OUTPUT.md', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vav-timer-sched-'))
    const conversations = new ConversationStore(root)
    conversations.load({ model: VAV_DEFAULT_MODEL_ID, mintWorkdir: () => root })
    const timers = new TimerStore(root)
    timers.bind(conversations)
    const job = timers.upsertJob({ title: 'Nightly', prompt: 'write the report', everyMinutes: 60 })

    const ran: string[] = []
    const scheduler = new TimerScheduler({
      timers,
      conversations,
      settings: {
        get: () => ({ defaultModel: VAV_DEFAULT_MODEL_ID, defaultThinkingLevel: 'high' })
      } as never,
      agent: {
        run: async (id: string, text: string) => {
          ran.push(text)
          conversations.appendMessage(id, {
            id: 'a1',
            parentId: conversations.activeLeaf(id),
            role: 'assistant',
            content: 'ok',
            blocks: [{ kind: 'text', text: 'built it' }],
            createdAt: Date.now()
          })
          conversations.setActiveLeaf(id, 'a1')
        }
      } as never,
      workspaceRoot: root
    })

    const result = await scheduler.runNow(job.id)
    assert.ok(result?.sessionId)
    assert.deepEqual(ran, ['write the report'])
    const session = conversations.get(result!.sessionId)!
    assert.equal(session.timerJobId, job.id)
    assert.ok(session.workingDirectory?.includes('/timers/'))
    assert.ok(session.workingDirectory?.endsWith('/Workspace'))
    assert.equal(conversations.listMeta().some((row) => row.id === session.id), false)
    const output = join(session.workingDirectory!, 'OUTPUT.md')
    assert.equal(existsSync(output), true)
    assert.equal(readFileSync(output, 'utf8'), 'built it\n')
    assert.equal(timers.listSessions()[0]?.status, 'done')
  })
})
