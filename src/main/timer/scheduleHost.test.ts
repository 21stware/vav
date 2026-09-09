import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, it } from 'node:test'
import { ConversationStore } from '../store/ConversationStore.ts'
import { TimerStore } from '../store/TimerStore.ts'
import { TimerScheduler } from './TimerScheduler.ts'

const root = join(import.meta.dirname, '../../..')
const aliasHook = pathToFileURL(join(root, 'scripts/register-shared-alias.mjs')).href

function stores(dir: string): {
  timers: TimerStore
  conversations: ConversationStore
} {
  const timers = new TimerStore(dir)
  timers.load()
  const conversations = new ConversationStore(dir)
  conversations.load({ model: 'test', mintWorkdir: () => join(dir, 'Workspace') })
  return { timers, conversations }
}

describe('scheduled task host', () => {
  it('creates a definition conversation, then fires from a shared vavServer store', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-sched-host-'))
    const desktop = stores(dir)
    const definition = desktop.conversations.create(join(dir, 'Workspace'), 'test', {
      sessionKind: 'timer',
      title: 'Scheduled task'
    })
    const job = desktop.timers.createJob({
      title: definition.title,
      prompt: '',
      schedule: { kind: 'interval', everyMs: 60 * 60 * 1000 },
      enabled: false,
      conversationId: definition.id,
      workdirPolicy: 'source',
      sourceWorkdir: definition.workingDirectory
    })
    desktop.conversations.updateMeta(definition.id, { timerJobId: job.id, sessionKind: 'timer' })
    assert.equal(desktop.conversations.listTimerMeta()[0]?.id, definition.id)
    assert.equal(desktop.conversations.listMeta().some((row) => row.id === definition.id), false)

    const now = 2_000_000
    desktop.timers.updateJob(
      job.id,
      { prompt: 'Check Cloudflare deploys', enabled: true, schedule: { kind: 'once', at: now } },
      now - 1
    )

    const vavServer = stores(dir)
    const ran: string[] = []
    const scheduler = new TimerScheduler({
      store: vavServer.timers,
      conversations: vavServer.conversations,
      tmp: dir,
      defaultModel: () => 'test',
      runTurn: (id) => {
        ran.push(id)
      },
      isRunning: () => false,
      reload: () => vavServer.timers.load()
    })
    await scheduler.tick(now)
    assert.equal(ran.length, 1)
    const run = vavServer.timers.listRuns(job.id)[0]
    assert.ok(run)
    assert.equal(run.status, 'running')
    assert.equal(vavServer.conversations.get(run.conversationId)?.sessionKind, 'timer')
    assert.equal(vavServer.conversations.get(run.conversationId)?.timerJobId, job.id)
    assert.ok(existsSync(join(run.workdir, 'brief.md')))
  })

  it('vavServer process fires a due job from ~/.vavServer-style state', async () => {
    const state = await mkdtemp(join(tmpdir(), 'vavServer-timer-'))
    const now = Date.now()
    mkdirSync(join(state, 'timers'), { recursive: true })
    writeFileSync(
      join(state, 'timers', 'jobs.json'),
      JSON.stringify(
        [
          {
            id: 'job-due',
            title: 'Due job',
            prompt: 'Write a status note',
            schedule: { kind: 'once', at: now - 1_000 },
            enabled: true,
            conversationId: null,
            workdirPolicy: 'mint',
            sourceWorkdir: null,
            connectorIds: [],
            createdAt: now - 2_000,
            updatedAt: now - 2_000,
            lastRunAt: null,
            nextRunAt: now - 1_000,
            lastStatus: null
          }
        ],
        null,
        2
      )
    )

    const child: ChildProcess = spawn(
      process.execPath,
      [
        '--import',
        aliasHook,
        '--experimental-strip-types',
        join(root, 'packages/vav-server/src/vav-server.ts'),
        '--listen',
        '127.0.0.1',
        '--port',
        '0',
        '--no-web',
        '--state',
        state,
        '--no-announce',
        '--name',
        'timer-vavServer'
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: root,
        env: {
          ...process.env,
          VAV_E2E: '1',
          VAV_E2E_STUB_TURN: '1'
        }
      }
    )
    let stdout = ''
    let stderr = ''
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
    })
    const stop = (): Promise<void> =>
      new Promise((resolve) => {
        if (child.exitCode != null || child.signalCode != null) {
          resolve()
          return
        }
        child.once('exit', () => resolve())
        child.kill('SIGTERM')
        setTimeout(() => {
          try {
            child.kill('SIGKILL')
          } catch {
            /* gone */
          }
          resolve()
        }, 1_500).unref()
      })

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`vavServer did not start\n${stdout}\n${stderr}`)), 12_000)
        const onData = (): void => {
          if (stdout.includes('vavrtp:') || stdout.includes('vav-daemon:')) {
            clearTimeout(timer)
            resolve()
          }
        }
        child.stdout?.on('data', onData)
        child.on('exit', (code) => {
          clearTimeout(timer)
          reject(new Error(`vavServer exited ${code}: ${stderr || stdout}`))
        })
        onData()
      })

      const runsPath = join(state, 'timers', 'runs.json')
      const deadline = Date.now() + 8_000
      let runs: Array<{ status?: string; jobId?: string; workdir?: string }> = []
      while (Date.now() < deadline) {
        if (existsSync(runsPath)) {
          try {
            const parsed = JSON.parse(readFileSync(runsPath, 'utf8')) as unknown
            if (Array.isArray(parsed)) runs = parsed as typeof runs
          } catch {
            /* write race */
          }
          if (runs.some((run) => run.jobId === 'job-due')) break
        }
        await new Promise((resolve) => setTimeout(resolve, 80))
      }
      const run = runs.find((row) => row.jobId === 'job-due')
      assert.ok(run, `vavServer did not fire the due job\n${stdout}\n${stderr}`)
      assert.ok(run.status === 'running' || run.status === 'done', run.status)
      if (run.workdir) {
        assert.ok(existsSync(join(run.workdir, 'brief.md')))
      }
    } finally {
      await stop()
      await rm(state, { recursive: true, force: true })
    }
  })
})
