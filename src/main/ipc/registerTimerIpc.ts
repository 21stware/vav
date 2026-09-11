import type { IpcMain } from 'electron'
import { IPC } from '@shared/ipc'
import type { TimerJobInput } from '@shared/timer'
import { conversationToMeta } from '../store/conversationMeta'
import type { TimerStore } from '../store/TimerStore'
import type { TimerScheduler } from '../timer/TimerScheduler'
import type { ConversationStore } from '../store/ConversationStore'
import type { Conversation } from '@shared/types'

export type TimerIpcRemote = {
  request: (method: string, params?: unknown) => Promise<unknown>
}

export type TimerIpcHost = {
  createDefinitionConversation: () => Conversation
  publishConversations: () => void
  /** Spawned loopback vav-server — sidebar timers share the store Chrome / vav-board use. */
  remote?: () => TimerIpcRemote | null
}

export function registerTimerIpc(
  ipcMain: IpcMain,
  store: TimerStore,
  scheduler: TimerScheduler,
  conversations: ConversationStore,
  broadcast: () => void,
  host: TimerIpcHost
): void {
  const remote = (): TimerIpcRemote | null => host.remote?.() ?? null
  const syncLocal = (): void => {
    store.load()
  }

  ipcMain.handle(IPC.timersListJobs, async () => {
    const client = remote()
    if (client) return client.request('timers.listJobs')
    return store.listJobs()
  })
  ipcMain.handle(IPC.timersCreateScheduled, async () => {
    const client = remote()
    if (client) {
      const result = await client.request('timers.createScheduled')
      syncLocal()
      broadcast()
      return result
    }
    const conversation = host.createDefinitionConversation()
    const job = store.createJob({
      title: conversation.title,
      prompt: '',
      schedule: { kind: 'cron', expr: '0 9 * * *' },
      enabled: false,
      conversationId: conversation.id,
      workdirPolicy: 'mint',
      sourceWorkdir: null
    })
    conversations.updateMeta(conversation.id, { timerJobId: job.id, sessionKind: 'timer' })
    host.publishConversations()
    broadcast()
    const next = conversations.get(conversation.id) ?? conversation
    return { job, conversation: conversationToMeta(next) }
  })
  ipcMain.handle(IPC.timersGetJobForConversation, async (_event, conversationId: string) => {
    const client = remote()
    if (client) return client.request('timers.getJobForConversation', { conversationId })
    return store.getJobForConversation(conversationId) ?? null
  })
  ipcMain.handle(IPC.timersCreateJob, async (_event, input: TimerJobInput) => {
    const client = remote()
    if (client) {
      const job = await client.request('timers.createJob', { input })
      syncLocal()
      broadcast()
      return job
    }
    const job = store.createJob(input)
    broadcast()
    return job
  })
  ipcMain.handle(
    IPC.timersUpdateJob,
    async (_event, id: string, patch: Partial<TimerJobInput> & { enabled?: boolean }) => {
      const client = remote()
      if (client) {
        const job = await client.request('timers.updateJob', { id, patch })
        syncLocal()
        broadcast()
        return job
      }
      const job = store.updateJob(id, patch)
      broadcast()
      return job
    }
  )
  ipcMain.handle(IPC.timersRemoveJob, async (_event, id: string) => {
    const client = remote()
    if (client) {
      let ok = false
      try {
        ok = (await client.request('timers.removeJob', { id })) === true
      } catch {
        ok = false
      }
      syncLocal()
      if (!ok) ok = store.removeJob(id)
      broadcast()
      return ok
    }
    const ok = store.removeJob(id)
    if (ok) broadcast()
    return ok
  })
  ipcMain.handle(IPC.timersRunNow, async (_event, id: string) => {
    const client = remote()
    if (client) {
      const result = await client.request('timers.runNow', { id })
      syncLocal()
      broadcast()
      return result
    }
    const result = scheduler.runNow(id)
    broadcast()
    return result
  })
  ipcMain.handle(IPC.timersListRuns, async (_event, jobId?: string) => {
    const client = remote()
    if (client) return client.request('timers.listRuns', { jobId })
    return store.listRuns(jobId)
  })
  ipcMain.handle(IPC.timersListSessions, async () => {
    const client = remote()
    if (client) return client.request('timers.listSessions')
    return conversations.listTimerMeta()
  })
}
